import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { AuditService } from '../audit/audit.service';
import {
  AcceptInvitationNewUserDto,
  ChangeRoleDto,
  CreateInvitationDto,
  SetPermissionOverrideDto,
} from './dto/membership.dto';

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  private assertCanManageUsers(role: string) {
    if (!['OWNER', 'PARTNER'].includes(role)) {
      throw new ForbiddenException('Управлять участниками может владелец или партнёр');
    }
  }

  async listMembers(userId: string, familySpaceId: string) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'USERS', 'VIEW');
    return this.prisma.membership.findMany({
      where: { familySpaceId },
      include: { person: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async invite(userId: string, familySpaceId: string, dto: CreateInvitationDto) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    this.assertCanManageUsers(membership.role);
    if (dto.role === 'OWNER' && membership.role !== 'OWNER') {
      throw new ForbiddenException('Назначить роль владельца может только текущий владелец');
    }

    const token = crypto.randomBytes(24).toString('hex');
    const invitation = await this.prisma.invitation.create({
      data: {
        familySpaceId,
        email: dto.email,
        role: dto.role,
        token,
        invitedByUserId: userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'membership.invite',
      resourceType: 'Invitation',
      resourceId: invitation.id,
      metadata: { email: dto.email, role: dto.role },
    });

    // Примечание (техдолг Итерации 1): реальная отправка email не реализована —
    // это задача интеграционного слоя. Токен приглашения возвращается вызывающей
    // стороне (owner/partner) для ручной передачи, пока не подключён почтовый коннектор.
    return invitation;
  }

  async acceptInvitationAsNewUser(token: string, dto: AcceptInvitationNewUserDto) {
    const invitation = await this.prisma.invitation.findUnique({ where: { token } });
    if (!invitation || invitation.status !== 'PENDING' || invitation.expiresAt < new Date()) {
      throw new BadRequestException('Приглашение недействительно или истекло');
    }
    const existingUser = await this.prisma.user.findUnique({ where: { email: invitation.email } });
    if (existingUser) {
      throw new BadRequestException(
        'Пользователь с этим email уже зарегистрирован — используйте вход и присоединение к пространству',
      );
    }

    const passwordHash = await argon2.hash(dto.password);
    const result = await this.prisma.$transaction(async (tx: any) => {
      const user = await tx.user.create({ data: { email: invitation.email, passwordHash } });
      const person = await tx.person.create({
        data: { familySpaceId: invitation.familySpaceId, fullName: dto.fullName },
      });
      const membership = await tx.membership.create({
        data: {
          familySpaceId: invitation.familySpaceId,
          userId: user.id,
          personId: person.id,
          role: invitation.role,
          status: 'ACTIVE',
          invitedByUserId: invitation.invitedByUserId,
        },
      });
      await tx.invitation.update({ where: { id: invitation.id }, data: { status: 'ACCEPTED' } });
      return { user, person, membership };
    });

    await this.audit.log({
      familySpaceId: invitation.familySpaceId,
      actorUserId: result.user.id,
      action: 'membership.accept',
      resourceType: 'Membership',
      resourceId: result.membership.id,
    });

    return result;
  }

  async changeRole(userId: string, familySpaceId: string, membershipId: string, dto: ChangeRoleDto) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    this.assertCanManageUsers(membership.role);
    if (membership.role !== 'OWNER' && dto.role === 'OWNER') {
      throw new ForbiddenException('Назначить роль владельца может только текущий владелец');
    }
    const target = await this.prisma.membership.findUnique({ where: { id: membershipId } });
    if (!target || target.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Членство не найдено');
    }
    const updated = await this.prisma.membership.update({
      where: { id: membershipId },
      data: { role: dto.role },
    });
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'membership.role_change',
      resourceType: 'Membership',
      resourceId: membershipId,
      metadata: { from: target.role, to: dto.role },
    });
    return updated;
  }

  /** Приостановка/восстановление членства — вместо удаления пользователя из пространства. */
  async setStatus(
    userId: string,
    familySpaceId: string,
    membershipId: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'LEFT',
  ) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    this.assertCanManageUsers(membership.role);
    const target = await this.prisma.membership.findUnique({ where: { id: membershipId } });
    if (!target || target.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Членство не найдено');
    }
    if (target.role === 'OWNER' && status !== 'ACTIVE') {
      throw new BadRequestException('Нельзя приостановить единственного владельца пространства');
    }
    const updated = await this.prisma.membership.update({
      where: { id: membershipId },
      data: { status },
    });
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'membership.status_change',
      resourceType: 'Membership',
      resourceId: membershipId,
      metadata: { from: target.status, to: status },
    });
    return updated;
  }

  async setPermissionOverride(
    userId: string,
    familySpaceId: string,
    membershipId: string,
    dto: SetPermissionOverrideDto,
  ) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    if (membership.role !== 'OWNER') {
      throw new ForbiddenException('Точечные исключения из прав может задавать только владелец');
    }
    const override = await this.prisma.membershipPermissionOverride.upsert({
      where: {
        membershipId_resource_action: {
          membershipId,
          resource: dto.resource,
          action: dto.action,
        },
      },
      create: {
        membershipId,
        familySpaceId,
        resource: dto.resource,
        action: dto.action,
        allowed: dto.allowed,
        createdByUserId: userId,
      },
      update: { allowed: dto.allowed },
    });
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'membership.permission_override',
      resourceType: 'Membership',
      resourceId: membershipId,
      metadata: { resource: dto.resource, action: dto.action, allowed: dto.allowed },
    });
    return override;
  }
}
