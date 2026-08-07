import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { encryptSecret, decryptSecret, hashToken } from '../common/crypto.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface AuthContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private async issueTokens(userId: string, email: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m',
      },
    );
    const refreshToken = crypto.randomBytes(48).toString('hex');
    const ttlDays = 30;
    await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      },
    });
    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto, ctx: AuthContext) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Пользователь с таким email уже существует');
    }
    const passwordHash = await argon2.hash(dto.password);

    const result = await this.prisma.$transaction(async (tx: any) => {
      const user = await tx.user.create({
        data: { email: dto.email, passwordHash },
      });
      const familySpace = await tx.familySpace.create({
        data: { name: dto.familySpaceName },
      });
      const person = await tx.person.create({
        data: { familySpaceId: familySpace.id, fullName: dto.fullName },
      });
      const membership = await tx.membership.create({
        data: {
          familySpaceId: familySpace.id,
          userId: user.id,
          personId: person.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });
      return { user, familySpace, person, membership };
    });

    await this.audit.log({
      familySpaceId: result.familySpace.id,
      actorUserId: result.user.id,
      action: 'auth.register',
      resourceType: 'User',
      resourceId: result.user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const tokens = await this.issueTokens(result.user.id, result.user.email);
    return {
      ...tokens,
      user: { id: result.user.id, email: result.user.email, twoFactorEnabled: false },
      familySpace: { id: result.familySpace.id, name: result.familySpace.name },
      twoFactorSetupRequired: true,
    };
  }

  async login(dto: LoginDto, ctx: AuthContext) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const fail = async (reason: string) => {
      await this.prisma.loginAttempt.create({
        data: {
          email: dto.email,
          userId: user?.id,
          success: false,
          reason,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    };

    if (!user || user.status !== 'ACTIVE') {
      await fail('invalid_credentials');
      throw new UnauthorizedException('Неверный email или пароль');
    }

    const passwordOk = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordOk) {
      await fail('invalid_password');
      throw new UnauthorizedException('Неверный email или пароль');
    }

    if (user.twoFactorEnabled) {
      if (!dto.twoFactorCode) {
        await fail('2fa_required');
        throw new UnauthorizedException('Требуется код двухфакторной аутентификации');
      }
      const secret = decryptSecret(user.twoFactorSecret as string);
      const valid = authenticator.check(dto.twoFactorCode, secret);
      if (!valid) {
        await fail('invalid_2fa');
        throw new UnauthorizedException('Неверный код двухфакторной аутентификации');
      }
    }

    await this.prisma.loginAttempt.create({
      data: {
        email: dto.email,
        userId: user.id,
        success: true,
        reason: 'ok',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({
      actorUserId: user.id,
      action: 'auth.login',
      resourceType: 'User',
      resourceId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { familySpace: true },
    });

    const tokens = await this.issueTokens(user.id, user.email);
    return {
      ...tokens,
      user: { id: user.id, email: user.email, twoFactorEnabled: user.twoFactorEnabled },
      familySpaces: memberships.map((m: (typeof memberships)[number]) => ({
        id: m.familySpace.id,
        name: m.familySpace.name,
        role: m.role,
      })),
      twoFactorSetupRequired: !user.twoFactorEnabled,
    };
  }

  async refresh(refreshToken: string) {
    const hash = hashToken(refreshToken);
    const session = await this.prisma.session.findFirst({
      where: { refreshTokenHash: hash, revokedAt: null },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Сессия недействительна, требуется повторный вход');
    }
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(session.userId, session.user.email);
  }

  async logout(refreshToken: string) {
    const hash = hashToken(refreshToken);
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  async setupTwoFactor(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email, 'Family OS', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

    const recoveryCodes = Array.from({ length: 10 }, () =>
      crypto.randomBytes(5).toString('hex'),
    );
    const recoveryHashes = recoveryCodes.map((c) => hashToken(c));

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: encryptSecret(secret),
        twoFactorRecoveryCodes: JSON.stringify(recoveryHashes),
        twoFactorEnabled: false, // включится только после подтверждения кода
      },
    });

    return { otpauthUrl: otpauth, qrCodeDataUrl, recoveryCodes };
  }

  async confirmTwoFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorSecret) {
      throw new BadRequestException('Сначала нужно инициализировать настройку 2FA');
    }
    const secret = decryptSecret(user.twoFactorSecret);
    const valid = authenticator.check(code, secret);
    if (!valid) {
      throw new UnauthorizedException('Неверный код');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
    await this.audit.log({
      actorUserId: userId,
      action: 'auth.2fa.enabled',
      resourceType: 'User',
      resourceId: userId,
    });
    return { success: true };
  }

  async disableTwoFactor(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Неверный пароль');
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryCodes: null },
    });
    await this.audit.log({
      actorUserId: userId,
      action: 'auth.2fa.disabled',
      resourceType: 'User',
      resourceId: userId,
    });
    return { success: true };
  }
}
