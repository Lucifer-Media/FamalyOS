import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { AuditService } from '../audit/audit.service';
import { CreatePersonDto, UpdatePersonDto } from './dto/person.dto';

/**
 * Профили людей (членов семьи). Person существует независимо от User —
 * у ребёнка может не быть учётной записи для входа. Управление профилями
 * доступно тем, у кого есть право USERS:CREATE/EDIT (см. permissions.ts).
 */
@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, familySpaceId: string) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'GENERAL', 'VIEW');
    return this.prisma.person.findMany({
      where: { familySpaceId, status: { not: 'VOID' } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(userId: string, familySpaceId: string, dto: CreatePersonDto) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'USERS', 'CREATE');
    const person = await this.prisma.person.create({
      data: {
        familySpaceId,
        fullName: dto.fullName,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        gender: dto.gender,
        citizenship: dto.citizenship,
        contacts: dto.contacts as any,
        addresses: dto.addresses as any,
        notes: dto.notes,
      },
    });
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'person.create',
      resourceType: 'Person',
      resourceId: person.id,
    });
    return person;
  }

  async update(userId: string, familySpaceId: string, id: string, dto: UpdatePersonDto) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'USERS', 'EDIT');
    const existing = await this.prisma.person.findUnique({ where: { id } });
    if (!existing || existing.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Профиль не найден');
    }
    const updated = await this.prisma.person.update({
      where: { id },
      data: {
        fullName: dto.fullName ?? existing.fullName,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : existing.birthDate,
        gender: dto.gender ?? existing.gender,
        citizenship: dto.citizenship ?? existing.citizenship,
        contacts: (dto.contacts as any) ?? existing.contacts,
        addresses: (dto.addresses as any) ?? existing.addresses,
        notes: dto.notes ?? existing.notes,
      },
    });
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'person.update',
      resourceType: 'Person',
      resourceId: id,
    });
    return updated;
  }

  async archive(userId: string, familySpaceId: string, id: string) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'USERS', 'ARCHIVE');
    const existing = await this.prisma.person.findUnique({ where: { id } });
    if (!existing || existing.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Профиль не найден');
    }
    const hasActiveMembership = await this.prisma.membership.findFirst({
      where: { personId: id, status: 'ACTIVE', role: 'OWNER' },
    });
    if (hasActiveMembership) {
      throw new ForbiddenException('Нельзя архивировать профиль владельца пространства');
    }
    const updated = await this.prisma.person.update({ where: { id }, data: { status: 'ARCHIVED' } });
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'person.archive',
      resourceType: 'Person',
      resourceId: id,
    });
    return updated;
  }
}
