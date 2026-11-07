import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { AuditService } from '../audit/audit.service';
import { decryptSecret, encryptSecret, hashToken } from '../common/crypto.util';
import { AuthService, normalizeEmail } from './auth.service';
import { deviceLabel, passwordProblems } from './device-trust';

/**
 * Управление учётными записями участников владельцем (Итерация 4.2) —
 * карточка участника: ФИО, email, сброс пароля, 2FA (сброс / настройка
 * «при участнике» — QR на экране владельца), отзыв сессий и устройств,
 * журнал входов.
 *
 * Права: только роль OWNER (плюс USERS:MANAGE). Над своей учётной записью
 * владелец действует через «Мой профиль» (с подтверждением паролем), не
 * через этот сервис — кроме ФИО. Удаления пользователей нет: приостановка —
 * существующий статус членства («Приостановить» в списке участников).
 */
@Injectable()
export class AccountAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  private async target(actorUserId: string, familySpaceId: string, membershipId: string, opts: { allowSelf?: boolean; allowOwnerTarget?: boolean } = {}) {
    const actor = await this.permissions.getMembership(actorUserId, familySpaceId);
    if (actor.role !== 'OWNER') throw new ForbiddenException('Управлять учётными записями может только владелец');
    await this.permissions.assertCan(actor, 'USERS', 'MANAGE');
    const m = await this.prisma.membership.findUnique({ where: { id: membershipId }, include: { user: true, person: true } });
    if (!m || m.familySpaceId !== familySpaceId) throw new NotFoundException('Участник не найден');
    const isSelf = m.userId === actorUserId;
    if (isSelf && !opts.allowSelf) throw new BadRequestException('Свою учётную запись меняйте в «Мой профиль» — там нужно подтверждение паролем');
    if (!isSelf && m.role === 'OWNER' && !opts.allowOwnerTarget) throw new ForbiddenException('Учётную запись другого владельца менять нельзя');
    return { actor, m, isSelf };
  }

  async getAccount(actorUserId: string, familySpaceId: string, membershipId: string) {
    const actor = await this.permissions.getMembership(actorUserId, familySpaceId);
    await this.permissions.assertCan(actor, 'USERS', 'VIEW');
    const m = await this.prisma.membership.findUnique({ where: { id: membershipId }, include: { user: true, person: true } });
    if (!m || m.familySpaceId !== familySpaceId) throw new NotFoundException('Участник не найден');
    const isOwner = actor.role === 'OWNER';
    const [sessions, devices, attempts] = isOwner || m.userId === actorUserId
      ? await Promise.all([
          this.auth.listSessions(m.userId),
          this.auth.listDevices(m.userId),
          this.prisma.loginAttempt.findMany({ where: { userId: m.userId }, orderBy: { createdAt: 'desc' }, take: 25 }),
        ])
      : [[], [], []];
    return {
      membershipId: m.id,
      role: m.role,
      membershipStatus: m.status,
      isSelf: m.userId === actorUserId,
      canManage: isOwner && (m.userId === actorUserId || m.role !== 'OWNER'),
      person: { id: m.person.id, fullName: m.person.fullName },
      user: {
        id: m.user.id,
        email: m.user.email,
        status: m.user.status,
        twoFactorEnabled: m.user.twoFactorEnabled,
        twoFactorPending: !m.user.twoFactorEnabled && Boolean(m.user.twoFactorSecret),
        recoveryCodesRemaining: m.user.twoFactorRecoveryCodes ? (JSON.parse(m.user.twoFactorRecoveryCodes) as string[]).length : 0,
        lastLoginAt: m.user.lastLoginAt,
        createdAt: m.user.createdAt,
      },
      sessions,
      devices,
      loginAttempts: (attempts as { createdAt: Date; success: boolean; reason: string | null; ipAddress: string | null; userAgent: string | null }[]).map((a) => ({
        createdAt: a.createdAt,
        success: a.success,
        reason: a.reason,
        ipAddress: a.ipAddress,
        device: deviceLabel(a.userAgent),
      })),
    };
  }

  async updateProfile(actorUserId: string, familySpaceId: string, membershipId: string, dto: { fullName?: string; email?: string }) {
    const { m, isSelf } = await this.target(actorUserId, familySpaceId, membershipId, { allowSelf: true });
    const changes: Record<string, unknown> = {};
    if (dto.fullName !== undefined) {
      const fullName = dto.fullName.trim();
      if (!fullName) throw new BadRequestException('ФИО не может быть пустым');
      if (fullName !== m.person.fullName) {
        await this.prisma.person.update({ where: { id: m.personId }, data: { fullName } });
        changes.fullName = { from: m.person.fullName, to: fullName };
      }
    }
    if (dto.email !== undefined) {
      if (isSelf) throw new BadRequestException('Свой email меняйте в «Мой профиль» (нужен пароль)');
      const email = normalizeEmail(dto.email);
      if (email !== m.user.email) {
        const exists = await this.prisma.user.findUnique({ where: { email } });
        if (exists) throw new ConflictException('Этот email уже занят');
        await this.prisma.user.update({ where: { id: m.userId }, data: { email } });
        changes.email = { from: m.user.email, to: email };
      }
    }
    if (Object.keys(changes).length) {
      await this.audit.log({ familySpaceId, actorUserId, action: 'account.profile_updated', resourceType: 'User', resourceId: m.userId, metadata: changes });
    }
    return { success: true, changed: Object.keys(changes) };
  }

  /** Сброс пароля участнику (например, забыл): все его сессии и доверенные устройства отзываются. */
  async resetPassword(actorUserId: string, familySpaceId: string, membershipId: string, newPassword: string) {
    const { m } = await this.target(actorUserId, familySpaceId, membershipId);
    const problems = passwordProblems(newPassword, m.user.email);
    if (problems.length) throw new BadRequestException(problems.join('; '));
    await this.prisma.user.update({ where: { id: m.userId }, data: { passwordHash: await argon2.hash(newPassword) } });
    const sessions = await this.auth.revokeAllSessions(m.userId);
    const devices = await this.auth.revokeAllDevices(m.userId, actorUserId, 'Пароль сброшен владельцем');
    await this.audit.log({ familySpaceId, actorUserId, action: 'account.password_reset', resourceType: 'User', resourceId: m.userId, metadata: { revokedSessions: sessions, revokedDevices: devices } });
    return { success: true, revokedSessions: sessions, revokedDevices: devices };
  }

  async disableTwoFactor(actorUserId: string, familySpaceId: string, membershipId: string) {
    const { m } = await this.target(actorUserId, familySpaceId, membershipId);
    await this.prisma.user.update({ where: { id: m.userId }, data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryCodes: null } });
    const devices = await this.auth.revokeAllDevices(m.userId, actorUserId, '2FA сброшена владельцем');
    await this.audit.log({ familySpaceId, actorUserId, action: 'account.2fa_reset', resourceType: 'User', resourceId: m.userId, metadata: { revokedDevices: devices } });
    return { success: true };
  }

  /**
   * Включение 2FA «при участнике»: QR показывается на экране владельца,
   * участник сканирует своим телефоном и называет код — владелец вводит его
   * в confirmTwoFactor. Иначе участник сам включит 2FA при следующем входе
   * (вход всё равно требует настройки 2FA).
   */
  async setupTwoFactor(actorUserId: string, familySpaceId: string, membershipId: string) {
    const { m } = await this.target(actorUserId, familySpaceId, membershipId);
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(m.user.email, 'Family OS', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    const recoveryCodes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString('hex'));
    await this.prisma.user.update({
      where: { id: m.userId },
      data: { twoFactorSecret: encryptSecret(secret), twoFactorRecoveryCodes: JSON.stringify(recoveryCodes.map((c) => hashToken(c))), twoFactorEnabled: false },
    });
    await this.audit.log({ familySpaceId, actorUserId, action: 'account.2fa_setup_started', resourceType: 'User', resourceId: m.userId });
    return { otpauthUrl, qrCodeDataUrl, recoveryCodes };
  }

  async confirmTwoFactor(actorUserId: string, familySpaceId: string, membershipId: string, code: string) {
    const { m } = await this.target(actorUserId, familySpaceId, membershipId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: m.userId } });
    if (!user.twoFactorSecret) throw new BadRequestException('Сначала начните настройку 2FA');
    if (!authenticator.check(String(code ?? '').replace(/\s/g, ''), decryptSecret(user.twoFactorSecret))) throw new UnauthorizedException('Неверный код');
    await this.prisma.user.update({ where: { id: m.userId }, data: { twoFactorEnabled: true } });
    await this.audit.log({ familySpaceId, actorUserId, action: 'account.2fa_enabled', resourceType: 'User', resourceId: m.userId });
    return { success: true };
  }

  async revokeSessions(actorUserId: string, familySpaceId: string, membershipId: string) {
    const { m } = await this.target(actorUserId, familySpaceId, membershipId);
    const count = await this.auth.revokeAllSessions(m.userId);
    await this.audit.log({ familySpaceId, actorUserId, action: 'account.sessions_revoked', resourceType: 'User', resourceId: m.userId, metadata: { count } });
    return { revoked: count };
  }

  async revokeDevice(actorUserId: string, familySpaceId: string, membershipId: string, deviceId: string) {
    const { m } = await this.target(actorUserId, familySpaceId, membershipId);
    return this.auth.revokeDevice(m.userId, deviceId, actorUserId, 'Отозвано владельцем');
  }
}
