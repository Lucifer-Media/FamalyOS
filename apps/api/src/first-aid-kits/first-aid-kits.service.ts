import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';

export interface ExpiringItem {
  id: string;
  title: string;
  expiryDate: string;
  kitId: string | null;
  daysLeft: number;
}

/**
 * Раздел 12 ТЗ Итерации 2: «Через 30 дней истекает срок годности N препаратов».
 * Позиции аптечки хранятся как обычные Entity (entityType='first_aid_kit_item')
 * с датой в JSONB-поле attributes.expiryDate — отчёт читает это поле напрямую
 * через Postgres JSON-оператор, без отдельной таблицы под конкретно эту выборку.
 */
@Injectable()
export class FirstAidKitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async getExpiringItems(
    userId: string,
    familySpaceId: string,
    daysAhead = 30,
  ): Promise<ExpiringItem[]> {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'MEDICAL', 'VIEW');

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id, title,
             attributes->>'expiryDate' AS "expiryDate",
             attributes->>'kitId' AS "kitId",
             (attributes->>'expiryDate')::date - CURRENT_DATE AS "daysLeft"
      FROM entities
      WHERE "familySpaceId" = $1
        AND "entityType" = 'first_aid_kit_item'
        AND status = 'ACTIVE'
        AND attributes->>'expiryDate' IS NOT NULL
        AND (attributes->>'expiryDate')::date <= CURRENT_DATE + $2::int
      ORDER BY (attributes->>'expiryDate')::date ASC
      `,
      familySpaceId,
      daysAhead,
    );

    return rows as ExpiringItem[];
  }
}
