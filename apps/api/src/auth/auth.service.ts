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
import { AuthContext } from './client-context';
import { addKnownIp, decideDeviceTrust, deviceLabel, ipPolicyFromEnv, normalizeIp, passwordProblems, trustedDeviceDays } from './device-trust';

export type { AuthContext };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private async issueTokens(userId: string, email: string, ctx: AuthContext = {}) {
    const refreshToken = crypto.randomBytes(48).toString('hex');
    const ttlDays = 30;
    // Итерация 4.2: сессия хранит устройство и IP (раньше поля были, но не
    // заполнялись) — видно в «Мой профиль → Сессии», можно отозвать.
    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: hashToken(refreshToken),
        userAgent: ctx.userAgent,
        ipAddress: normalizeIp(ctx.ipAddress) ?? undefined,
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      },
    });
    // sid в access-токене: отзыв сессии действует сразу, а не через 15 минут.
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, sid: session.id },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m',
      },
    );
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

    const tokens = await this.issueTokens(result.user.id, result.user.email, ctx);
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

    const ip = normalizeIp(ctx.ipAddress);
    const device = dto.deviceToken
      ? await this.prisma.trustedDevice.findUnique({ where: { tokenHash: hashToken(dto.deviceToken) } })
      : null;
    let usedTrustedDevice = false;
    let issuedDevice: { deviceToken: string; deviceExpiresAt: string } | undefined;

    if (user.twoFactorEnabled) {
      const decision = decideDeviceTrust(
        device ? { userId: device.userId, knownIps: (device.knownIps as string[]) ?? [], expiresAt: device.expiresAt, revokedAt: device.revokedAt } : null,
        user.id,
        ip,
        new Date(),
        ipPolicyFromEnv(),
      );
      if (!dto.twoFactorCode && decision.trusted) {
        usedTrustedDevice = true;
        await this.prisma.trustedDevice.update({ where: { id: device!.id }, data: { lastUsedAt: new Date(), lastUsedIp: ip } });
      } else {
        const newIp = !decision.trusted && decision.reason === 'new_ip';
        if (!dto.twoFactorCode) {
          await fail(newIp ? '2fa_required_new_ip' : '2fa_required');
          throw new UnauthorizedException(
            newIp
              ? 'Требуется код двухфакторной аутентификации: устройство запомнено, но вход с нового IP-адреса'
              : 'Требуется код двухфакторной аутентификации',
          );
        }
        const secret = decryptSecret(user.twoFactorSecret as string);
        const valid = authenticator.check(dto.twoFactorCode, secret);
        if (!valid) {
          await fail('invalid_2fa');
          throw new UnauthorizedException('Неверный код двухфакторной аутентификации');
        }
        // Код верный. Если это уже запомненное устройство (просто новый IP) — запоминаем IP.
        if (device && device.userId === user.id && !device.revokedAt && device.expiresAt > new Date()) {
          await this.prisma.trustedDevice.update({
            where: { id: device.id },
            data: { knownIps: addKnownIp((device.knownIps as string[]) ?? [], ip), lastUsedAt: new Date(), lastUsedIp: ip },
          });
          await this.audit.log({ actorUserId: user.id, action: 'auth.device.ip_added', resourceType: 'TrustedDevice', resourceId: device.id, ipAddress: ip ?? undefined, userAgent: ctx.userAgent });
        } else if (dto.rememberDevice) {
          issuedDevice = await this.createTrustedDevice(user.id, ctx);
        }
      }
    }

    await this.prisma.loginAttempt.create({
      data: {
        email: dto.email,
        userId: user.id,
        success: true,
        reason: usedTrustedDevice ? 'trusted_device' : 'ok',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({
      actorUserId: user.id,
      action: usedTrustedDevice ? 'auth.login.trusted_device' : 'auth.login',
      resourceType: 'User',
      resourceId: user.id,
      ipAddress: ip ?? undefined,
      userAgent: ctx.userAgent,
      metadata: usedTrustedDevice ? { deviceId: device!.id } : undefined,
    });

    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { familySpace: true },
    });

    const tokens = await this.issueTokens(user.id, user.email, ctx);
    return {
      ...tokens,
      user: { id: user.id, email: user.email, twoFactorEnabled: user.twoFactorEnabled },
      familySpaces: memberships.map((m: (typeof memberships)[number]) => ({
        id: m.familySpace.id,
        name: m.familySpace.name,
        role: m.role,
      })),
      // Итерация 4.2: отправлять на настройку 2FA, только если хоть одно
      // пространство пользователя её требует (настройка владельца).
      twoFactorSetupRequired: !user.twoFactorEnabled && memberships.some((m: (typeof memberships)[number]) => m.familySpace.requireTwoFactor !== false),
      trustedDevice: usedTrustedDevice,
      ...(issuedDevice ?? {}),
    };
  }

  private async createTrustedDevice(userId: string, ctx: AuthContext) {
    const token = crypto.randomBytes(32).toString('hex');
    const ip = normalizeIp(ctx.ipAddress);
    const expiresAt = new Date(Date.now() + trustedDeviceDays() * 86400000);
    const device = await this.prisma.trustedDevice.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        label: deviceLabel(ctx.userAgent),
        userAgent: ctx.userAgent,
        knownIps: ip ? [ip] : [],
        createdIp: ip,
        lastUsedIp: ip,
        lastUsedAt: new Date(),
        expiresAt,
      },
    });
    await this.audit.log({ actorUserId: userId, action: 'auth.device.trusted', resourceType: 'TrustedDevice', resourceId: device.id, ipAddress: ip ?? undefined, userAgent: ctx.userAgent, metadata: { label: device.label, expiresAt } });
    return { deviceToken: token, deviceExpiresAt: expiresAt.toISOString() };
  }

  async refresh(refreshToken: string, ctx: AuthContext = {}) {
    const hash = hashToken(refreshToken);
    const session = await this.prisma.session.findFirst({
      where: { refreshTokenHash: hash, revokedAt: null },
      include: { user: true },
    });
    // Итерация 4.2: приостановленный пользователь не продлевает сессию.
    if (!session || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Сессия недействительна, требуется повторный вход');
    }
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(session.userId, session.user.email, { userAgent: ctx.userAgent ?? session.userAgent ?? undefined, ipAddress: ctx.ipAddress ?? session.ipAddress ?? undefined });
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
    // Итерация 4.2 (безопасность): раньше повторный вызов setup при ВКЛЮЧЁННОЙ
    // 2FA молча выключал её (twoFactorEnabled=false) — любая сессия могла
    // снять 2FA без пароля. Перенастройка — только через отключение паролем.
    if (user.twoFactorEnabled) {
      throw new BadRequestException('2FA уже включена. Чтобы перенастроить, сначала отключите её с подтверждением паролем');
    }
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
    await this.revokeAllDevices(userId, userId, 'Отключена 2FA');
    await this.audit.log({
      actorUserId: userId,
      action: 'auth.2fa.disabled',
      resourceType: 'User',
      resourceId: userId,
    });
    return { success: true };
  }

  /** Вход по одноразовому recovery-коду 2FA. */
  async loginWithRecoveryCode(email: string, recoveryCode: string, ctx: AuthContext) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const fail = async (reason: string) => {
      await this.prisma.loginAttempt.create({
        data: {
          email,
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
      throw new UnauthorizedException('Неверный email или recovery-код');
    }

    if (!user.twoFactorEnabled || !user.twoFactorRecoveryCodes) {
      await fail('2fa_not_enabled');
      throw new UnauthorizedException('2FA не включена или recovery-коды не настроены');
    }

    const recoveryCodesHashes = JSON.parse(user.twoFactorRecoveryCodes) as string[];
    const codeMatch = recoveryCodesHashes.find((hash) => hashToken(recoveryCode) === hash);

    if (!codeMatch) {
      await fail('invalid_recovery_code');
      throw new UnauthorizedException('Неверный recovery-код');
    }

    const newHashes = recoveryCodesHashes.filter((h) => h !== codeMatch);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorRecoveryCodes: JSON.stringify(newHashes) },
    });

    await this.prisma.loginAttempt.create({
      data: {
        email,
        userId: user.id,
        success: true,
        reason: 'recovery_code',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({
      actorUserId: user.id,
      action: 'auth.login.recovery',
      resourceType: 'User',
      resourceId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { familySpace: true },
    });

    const tokens = await this.issueTokens(user.id, user.email, ctx);
    return {
      ...tokens,
      user: { id: user.id, email: user.email, twoFactorEnabled: user.twoFactorEnabled },
      familySpaces: memberships.map((m: (typeof memberships)[number]) => ({
        id: m.familySpace.id,
        name: m.familySpace.name,
        role: m.role,
      })),
      recoveryCodesRemaining: newHashes.length,
    };
  }

  /** Перевыпуск recovery-кодов (старые становятся недействительны) — требует подтверждения паролем. */
  async regenerateRecoveryCodes(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Неверный пароль');

    const recoveryCodes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString('hex'));
    const recoveryHashes = recoveryCodes.map((c) => hashToken(c));

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorRecoveryCodes: JSON.stringify(recoveryHashes) },
    });

    await this.audit.log({
      actorUserId: userId,
      action: 'auth.2fa.recovery_codes_regenerated',
      resourceType: 'User',
      resourceId: userId,
    });

    return { recoveryCodes };
  }

  /** Статус recovery-кодов — сколько осталось неиспользованных, без раскрытия самих кодов. */
  async getRecoveryCodesStatus(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorRecoveryCodes) {
      return { enabled: false, count: 0 };
    }
    const hashes = JSON.parse(user.twoFactorRecoveryCodes) as string[];
    return { enabled: true, count: hashes.length };
  }

  // ---------- Итерация 4.2: профиль, сессии, устройства ----------

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const recovery = user.twoFactorRecoveryCodes ? (JSON.parse(user.twoFactorRecoveryCodes) as string[]).length : 0;
    const spaces = await this.prisma.membership.findMany({ where: { userId, status: 'ACTIVE' }, include: { familySpace: true } });
    const twoFactorRequired = spaces.some((m: (typeof spaces)[number]) => m.familySpace.requireTwoFactor !== false);
    return { id: user.id, email: user.email, status: user.status, twoFactorEnabled: user.twoFactorEnabled, twoFactorRequired, recoveryCodesRemaining: recovery, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt };
  }

  /** Смена своего пароля: нужен текущий. Остальные сессии и все доверенные устройства отзываются. */
  async changePassword(userId: string, currentPassword: string, newPassword: string, currentSessionId?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, currentPassword ?? ''))) throw new UnauthorizedException('Текущий пароль неверный');
    const problems = passwordProblems(newPassword, user.email);
    if (problems.length) throw new BadRequestException(problems.join('; '));
    if (await argon2.verify(user.passwordHash, newPassword)) throw new BadRequestException('Новый пароль совпадает с текущим');
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await argon2.hash(newPassword) } });
    const revoked = await this.revokeAllSessions(userId, currentSessionId);
    await this.revokeAllDevices(userId, userId, 'Смена пароля');
    await this.audit.log({ actorUserId: userId, action: 'auth.password.changed', resourceType: 'User', resourceId: userId, metadata: { revokedSessions: revoked } });
    return { success: true, revokedSessions: revoked };
  }

  async changeEmail(userId: string, password: string, newEmail: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, password ?? ''))) throw new UnauthorizedException('Пароль неверный');
    const email = normalizeEmail(newEmail);
    if (email === user.email) return { success: true, email };
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('Этот email уже занят');
    await this.prisma.user.update({ where: { id: userId }, data: { email } });
    await this.audit.log({ actorUserId: userId, action: 'auth.email.changed', resourceType: 'User', resourceId: userId, metadata: { from: user.email, to: email } });
    return { success: true, email };
  }

  async listSessions(userId: string, currentSessionId?: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return sessions.map((x: (typeof sessions)[number]) => ({
      id: x.id,
      label: deviceLabel(x.userAgent),
      ipAddress: x.ipAddress,
      createdAt: x.createdAt,
      expiresAt: x.expiresAt,
      current: x.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string, actorUserId = userId) {
    const res = await this.prisma.session.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (res.count) await this.audit.log({ actorUserId, action: 'auth.session.revoked', resourceType: 'Session', resourceId: sessionId, metadata: { userId } });
    return { revoked: res.count };
  }

  async revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
    const res = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }

  async listDevices(userId: string) {
    const devices = await this.prisma.trustedDevice.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    const now = new Date();
    return devices.map((d: (typeof devices)[number]) => ({
      id: d.id,
      label: d.label,
      knownIps: d.knownIps,
      createdAt: d.createdAt,
      lastUsedAt: d.lastUsedAt,
      lastUsedIp: d.lastUsedIp,
      expiresAt: d.expiresAt,
      revokedAt: d.revokedAt,
      revokeReason: d.revokeReason,
      active: !d.revokedAt && d.expiresAt > now,
    }));
  }

  async revokeDevice(userId: string, deviceId: string, actorUserId = userId, reason = 'Отозвано пользователем') {
    const res = await this.prisma.trustedDevice.updateMany({
      where: { id: deviceId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedByUserId: actorUserId, revokeReason: reason },
    });
    if (res.count) await this.audit.log({ actorUserId, action: 'auth.device.revoked', resourceType: 'TrustedDevice', resourceId: deviceId, metadata: { userId, reason } });
    return { revoked: res.count };
  }

  async revokeAllDevices(userId: string, actorUserId: string, reason: string): Promise<number> {
    const res = await this.prisma.trustedDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedByUserId: actorUserId, revokeReason: reason },
    });
    if (res.count) await this.audit.log({ actorUserId, action: 'auth.device.revoked_all', resourceType: 'User', resourceId: userId, metadata: { count: res.count, reason } });
    return res.count;
  }

  /** Проверка access-токена: сессия не отозвана, пользователь активен (используется JwtStrategy). */
  async isSessionValid(userId: string, sessionId?: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!user || user.status !== 'ACTIVE') return false;
    if (!sessionId) return true; // токены, выданные до Итерации 4.2, живут до истечения (≤15 мин)
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { revokedAt: true, expiresAt: true, userId: true } });
    return Boolean(session && !session.revokedAt && session.expiresAt > new Date() && session.userId === userId);
  }
}

export function normalizeEmail(raw: string): string {
  const email = String(raw ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Некорректный email');
  return email;
}
