import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export interface AuditLogInput {
  familySpaceId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Журнал аудита — append-only. Записи никогда не удаляются и не изменяются.
 * Используется как для бизнес-действий (entity.create/update/archive...),
 * так и для событий безопасности (login, 2fa, permission.change).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        familySpaceId: input.familySpaceId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: (input.metadata as any) ?? undefined,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  async listForFamilySpace(
    familySpaceId: string,
    options: { limit?: number; before?: Date; action?: string } = {},
  ) {
    return this.prisma.auditLog.findMany({
      where: {
        familySpaceId,
        ...(options.action ? { action: options.action } : {}),
        ...(options.before ? { createdAt: { lt: options.before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 50,
    });
  }
}
