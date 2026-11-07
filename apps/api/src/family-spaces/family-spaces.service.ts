import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class FamilySpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  async listForUser(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { familySpace: true },
    });
    return memberships.map((m: (typeof memberships)[number]) => ({
      id: m.familySpace.id,
      name: m.familySpace.name,
      baseCurrency: m.familySpace.baseCurrency,
      requireTwoFactor: m.familySpace.requireTwoFactor,
      role: m.role,
      status: m.familySpace.status,
    }));
  }

  async getOne(userId: string, familySpaceId: string) {
    await this.permissions.getMembership(userId, familySpaceId); // проверка членства
    const space = await this.prisma.familySpace.findUniqueOrThrow({
      where: { id: familySpaceId },
    });
    return space;
  }

  async updateBaseCurrency(userId: string, familySpaceId: string, baseCurrency: string) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    if (membership.role !== 'OWNER') {
      throw new ForbiddenException('Изменять базовую валюту пространства может только владелец');
    }
    // Примечание: смена базовой валюты не пересчитывает исторические операции —
    // это реализуется в модуле финансов (Итерация 3). Здесь только само значение.
    return this.prisma.familySpace.update({
      where: { id: familySpaceId },
      data: { baseCurrency },
    });
  }

  /**
   * Итерация 4.2: «Требовать 2FA от всех участников». Выключено — 2FA
   * становится добровольной: после входа без 2FA не отправляем на настройку,
   * каждый может отключить её себе в профиле (с паролем), владелец — участнику.
   * Уже включённая у человека 2FA при этом продолжает спрашиваться.
   */
  async updateSecurity(userId: string, familySpaceId: string, requireTwoFactor: boolean) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    if (membership.role !== 'OWNER') throw new ForbiddenException('Менять политику безопасности может только владелец');
    if (typeof requireTwoFactor !== 'boolean') throw new BadRequestException('requireTwoFactor: true или false');
    const before = await this.prisma.familySpace.findUniqueOrThrow({ where: { id: familySpaceId } });
    const updated = await this.prisma.familySpace.update({ where: { id: familySpaceId }, data: { requireTwoFactor } });
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: requireTwoFactor ? 'security.2fa_required' : 'security.2fa_optional',
      resourceType: 'FamilySpace',
      resourceId: familySpaceId,
      metadata: { from: before.requireTwoFactor, to: requireTwoFactor },
    });
    return { requireTwoFactor: updated.requireTwoFactor };
  }
}
