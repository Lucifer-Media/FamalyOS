import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';

@Injectable()
export class FamilySpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
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
}
