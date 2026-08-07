import { Injectable, ForbiddenException } from '@nestjs/common';
import { PermissionAction, PermissionResource, ConfidentialityLevel } from './enums';
import { PrismaService } from './prisma.service';
import { roleAllows } from './permissions';

export interface MembershipContext {
  membershipId: string;
  familySpaceId: string;
  userId: string;
  personId: string;
  role: string;
}

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMembership(userId: string, familySpaceId: string): Promise<MembershipContext> {
    const membership = await this.prisma.membership.findUnique({
      where: { familySpaceId_userId: { familySpaceId, userId } },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('Нет активного членства в этом семейном пространстве');
    }
    return {
      membershipId: membership.id,
      familySpaceId,
      userId,
      personId: membership.personId,
      role: membership.role,
    };
  }

  /** Проверяет право membership на действие с ресурсом, с учётом точечных исключений. */
  async can(
    membership: MembershipContext,
    resource: PermissionResource,
    action: PermissionAction,
  ): Promise<boolean> {
    const override = await this.prisma.membershipPermissionOverride.findUnique({
      where: {
        membershipId_resource_action: {
          membershipId: membership.membershipId,
          resource,
          action,
        },
      },
    });
    if (override) return override.allowed;
    return roleAllows(membership.role as any, resource, action);
  }

  async assertCan(
    membership: MembershipContext,
    resource: PermissionResource,
    action: PermissionAction,
  ): Promise<void> {
    const allowed = await this.can(membership, resource, action);
    if (!allowed) {
      throw new ForbiddenException(
        `Недостаточно прав: ${resource}:${action} для роли ${membership.role}`,
      );
    }
  }

  /** Проверка доступа к строго конфиденциальным данным конкретной записи. */
  async assertConfidentialityAccess(
    membership: MembershipContext,
    level: ConfidentialityLevel,
  ): Promise<void> {
    if (level === 'STRICTLY_CONFIDENTIAL') {
      await this.assertCan(membership, 'CONFIDENTIAL', 'VIEW');
    }
  }
}
