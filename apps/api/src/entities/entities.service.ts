import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PermissionAction, PermissionResource } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService, MembershipContext } from '../common/permissions.service';
import { AuditService } from '../audit/audit.service';
import { CreateEntityDto, CreateEntityLinkDto, RevertEntityDto, UpdateEntityDto } from './dto/entity.dto';
import { getEntityTypeSchema } from '../entity-types/entity-type-registry';
import { validateEntityAttributes } from '../entity-types/attribute-validator';

/**
 * Сопоставление типа сущности с ресурсом прав доступа.
 * Источник правды для типов Итерации 2 (документы личности, активы,
 * медицина, лекарства, аптечки, аккаунты) — реестр в entity-types/
 * (тот же реестр используется для валидации attributes и построения форм
 * на frontend). Тип 'knowledge_article' — исключение из Итерации 1,
 * у него нет записи в реестре типов (это не "документ", это база знаний).
 */
const LEGACY_ENTITY_TYPE_RESOURCE: Record<string, PermissionResource> = {
  knowledge_article: 'KNOWLEDGE_BASE',
};

function resourceForType(entityType: string): PermissionResource {
  if (LEGACY_ENTITY_TYPE_RESOURCE[entityType]) {
    return LEGACY_ENTITY_TYPE_RESOURCE[entityType];
  }
  const schema = getEntityTypeSchema(entityType);
  return (schema?.resource as PermissionResource) ?? 'DOCUMENTS';
}

function buildSearchText(title: string, attributes: Record<string, unknown>): string {
  const content = typeof attributes?.content === 'string' ? attributes.content : '';
  return [title, content].filter(Boolean).join('\n').slice(0, 100_000);
}

@Injectable()
export class EntitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  private async requireMembershipAndPermission(
    userId: string,
    familySpaceId: string,
    entityType: string,
    action: PermissionAction,
  ): Promise<MembershipContext> {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, resourceForType(entityType), action);
    return membership;
  }

  async create(userId: string, familySpaceId: string, dto: CreateEntityDto) {
    const membership = await this.requireMembershipAndPermission(
      userId,
      familySpaceId,
      dto.entityType,
      'CREATE',
    );

    const validation = validateEntityAttributes(dto.entityType, dto.attributes);
    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Данные не прошли проверку для этого типа записи',
        errors: validation.errors,
      });
    }

    if (dto.parentEntityId) {
      const parent = await this.prisma.entity.findUnique({ where: { id: dto.parentEntityId } });
      if (!parent || parent.familySpaceId !== familySpaceId) {
        throw new BadRequestException('Родительская запись не найдена в этом пространстве');
      }
    }

    const entity = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.entity.create({
        data: {
          familySpaceId,
          entityType: dto.entityType,
          title: dto.title,
          ownerPersonId: dto.ownerPersonId,
          parentEntityId: dto.parentEntityId,
          confidentialityLevel: dto.confidentialityLevel ?? 'STANDARD',
          attributes: dto.attributes as any,
          searchText: buildSearchText(dto.title, dto.attributes),
          currentVersion: 1,
          createdByUserId: userId,
          updatedByUserId: userId,
        },
      });
      await tx.entityVersion.create({
        data: {
          entityId: created.id,
          versionNumber: 1,
          action: 'CREATE',
          snapshot: created as any,
          changeSummary: dto.changeSummary ?? 'Создание записи',
          changedByUserId: userId,
        },
      });
      return created;
    });

    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'entity.create',
      resourceType: entity.entityType,
      resourceId: entity.id,
      metadata: { title: entity.title },
    });

    return entity;
  }

  async findOne(userId: string, familySpaceId: string, id: string) {
    const entity = await this.prisma.entity.findUnique({ where: { id } });
    if (!entity || entity.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Сущность не найдена');
    }
    const membership = await this.requireMembershipAndPermission(
      userId,
      familySpaceId,
      entity.entityType,
      'VIEW',
    );
    await this.permissions.assertConfidentialityAccess(membership, entity.confidentialityLevel);
    return entity;
  }

  async list(
    userId: string,
    familySpaceId: string,
    filters: { entityType?: string; status?: string; ownerPersonId?: string; rootOnly?: boolean } = {},
  ) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    if (filters.entityType) {
      await this.permissions.assertCan(membership, resourceForType(filters.entityType), 'VIEW');
    }
    const entities = await this.prisma.entity.findMany({
      where: {
        familySpaceId,
        ...(filters.entityType ? { entityType: filters.entityType } : {}),
        ...(filters.status ? { status: filters.status as any } : { status: { not: 'VOID' } }),
        ...(filters.ownerPersonId ? { ownerPersonId: filters.ownerPersonId } : {}),
        ...(filters.rootOnly ? { parentEntityId: null } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    // Фильтруем по правам доступа к типу и к уровню конфиденциальности —
    // для смешанных списков (не отфильтрованных по типу) отсеиваем то,
    // на что у пользователя нет права VIEW.
    const visible = [];
    for (const e of entities) {
      const allowed = await this.permissions.can(membership, resourceForType(e.entityType), 'VIEW');
      if (!allowed) continue;
      if (
        e.confidentialityLevel === 'STRICTLY_CONFIDENTIAL' &&
        !(await this.permissions.can(membership, 'CONFIDENTIAL', 'VIEW'))
      ) {
        continue;
      }
      visible.push(e);
    }
    return visible;
  }

  async update(userId: string, familySpaceId: string, id: string, dto: UpdateEntityDto) {
    const entity = await this.prisma.entity.findUnique({ where: { id } });
    if (!entity || entity.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Сущность не найдена');
    }
    const membership = await this.requireMembershipAndPermission(
      userId,
      familySpaceId,
      entity.entityType,
      'EDIT',
    );
    await this.permissions.assertConfidentialityAccess(membership, entity.confidentialityLevel);

    const nextTitle = dto.title ?? entity.title;
    const nextAttributes = dto.attributes ? { ...(entity.attributes as any), ...dto.attributes } : entity.attributes;
    const nextVersion = entity.currentVersion + 1;

    const validation = validateEntityAttributes(entity.entityType, nextAttributes as Record<string, unknown>);
    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Данные не прошли проверку для этого типа записи',
        errors: validation.errors,
      });
    }

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const saved = await tx.entity.update({
        where: { id },
        data: {
          title: nextTitle,
          ownerPersonId: dto.ownerPersonId ?? entity.ownerPersonId,
          confidentialityLevel: dto.confidentialityLevel ?? entity.confidentialityLevel,
          attributes: nextAttributes as any,
          searchText: buildSearchText(nextTitle, nextAttributes as any),
          currentVersion: nextVersion,
          updatedByUserId: userId,
        },
      });
      await tx.entityVersion.create({
        data: {
          entityId: id,
          versionNumber: nextVersion,
          action: 'UPDATE',
          snapshot: saved as any,
          changeSummary: dto.changeSummary ?? 'Изменение записи',
          changedByUserId: userId,
        },
      });
      return saved;
    });

    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'entity.update',
      resourceType: entity.entityType,
      resourceId: id,
    });

    return updated;
  }

  async setStatus(
    userId: string,
    familySpaceId: string,
    id: string,
    status: 'ARCHIVED' | 'ACTIVE' | 'VOID',
    changeSummary?: string,
  ) {
    const entity = await this.prisma.entity.findUnique({ where: { id } });
    if (!entity || entity.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Сущность не найдена');
    }
    const membership = await this.requireMembershipAndPermission(
      userId,
      familySpaceId,
      entity.entityType,
      'ARCHIVE',
    );
    await this.permissions.assertConfidentialityAccess(membership, entity.confidentialityLevel);

    const nextVersion = entity.currentVersion + 1;
    const action = status === 'ARCHIVED' ? 'ARCHIVE' : status === 'VOID' ? 'VOID' : 'UNARCHIVE';

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const saved = await tx.entity.update({
        where: { id },
        data: { status, currentVersion: nextVersion, updatedByUserId: userId },
      });
      await tx.entityVersion.create({
        data: {
          entityId: id,
          versionNumber: nextVersion,
          action,
          snapshot: saved as any,
          changeSummary: changeSummary ?? `Статус изменён на ${status}`,
          changedByUserId: userId,
        },
      });
      return saved;
    });

    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: `entity.${action.toLowerCase()}`,
      resourceType: entity.entityType,
      resourceId: id,
    });

    return updated;
  }

  async listVersions(userId: string, familySpaceId: string, id: string) {
    await this.findOne(userId, familySpaceId, id); // проверка доступа
    return this.prisma.entityVersion.findMany({
      where: { entityId: id },
      orderBy: { versionNumber: 'desc' },
    });
  }

  /**
   * Откат к предыдущей версии НЕ уничтожает историю: создаётся НОВАЯ версия,
   * содержащая состояние выбранной старой версии (модель как в Git).
   */
  async revert(userId: string, familySpaceId: string, id: string, dto: RevertEntityDto) {
    const entity = await this.prisma.entity.findUnique({ where: { id } });
    if (!entity || entity.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Сущность не найдена');
    }
    const membership = await this.requireMembershipAndPermission(
      userId,
      familySpaceId,
      entity.entityType,
      'EDIT',
    );
    await this.permissions.assertConfidentialityAccess(membership, entity.confidentialityLevel);

    const target = await this.prisma.entityVersion.findUnique({
      where: { entityId_versionNumber: { entityId: id, versionNumber: dto.versionNumber } },
    });
    if (!target) throw new BadRequestException('Указанная версия не найдена');

    const snapshot = target.snapshot as any;
    const nextVersion = entity.currentVersion + 1;

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const saved = await tx.entity.update({
        where: { id },
        data: {
          title: snapshot.title,
          confidentialityLevel: snapshot.confidentialityLevel,
          attributes: snapshot.attributes,
          searchText: buildSearchText(snapshot.title, snapshot.attributes),
          currentVersion: nextVersion,
          updatedByUserId: userId,
        },
      });
      await tx.entityVersion.create({
        data: {
          entityId: id,
          versionNumber: nextVersion,
          action: 'REVERT',
          snapshot: saved as any,
          changeSummary: dto.changeSummary ?? `Откат к версии ${dto.versionNumber}`,
          revertedFromVersion: dto.versionNumber,
          changedByUserId: userId,
        },
      });
      return saved;
    });

    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'entity.revert',
      resourceType: entity.entityType,
      resourceId: id,
      metadata: { revertedFromVersion: dto.versionNumber },
    });

    return updated;
  }

  async link(userId: string, familySpaceId: string, sourceEntityId: string, dto: CreateEntityLinkDto) {
    const source = await this.findOne(userId, familySpaceId, sourceEntityId);
    const target = await this.findOne(userId, familySpaceId, dto.targetEntityId);
    const link = await this.prisma.entityLink.create({
      data: {
        sourceEntityId: source.id,
        targetEntityId: target.id,
        linkType: dto.linkType,
        note: dto.note,
        createdByUserId: userId,
      },
    });
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'entity.link',
      resourceType: 'EntityLink',
      resourceId: link.id,
      metadata: { sourceEntityId: source.id, targetEntityId: target.id, linkType: dto.linkType },
    });
    return link;
  }

  async listLinks(userId: string, familySpaceId: string, entityId: string) {
    await this.findOne(userId, familySpaceId, entityId);
    const [out, incoming] = await Promise.all([
      this.prisma.entityLink.findMany({
        where: { sourceEntityId: entityId },
        include: { targetEntity: true },
      }),
      this.prisma.entityLink.findMany({
        where: { targetEntityId: entityId },
        include: { sourceEntity: true },
      }),
    ]);
    return { outgoing: out, incoming };
  }

  /**
   * Дочерние сущности по физической иерархии (parentEntityId) — используется
   * деревом локаций (Страна → Город → Дом → Квартира) и вложенными записями
   * паспорта (регистрации/браки/дети). Это НЕ то же самое, что EntityLink —
   * там логические связи между произвольными сущностями.
   */
  async listChildren(userId: string, familySpaceId: string, entityId: string) {
    await this.findOne(userId, familySpaceId, entityId); // проверка доступа к родителю
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    const canConfidential = await this.permissions.can(membership, 'CONFIDENTIAL', 'VIEW');
    const children = await this.prisma.entity.findMany({
      where: {
        parentEntityId: entityId,
        familySpaceId,
        status: { not: 'VOID' },
      },
      orderBy: { createdAt: 'asc' },
    });
    const visible = [];
    for (const c of children) {
      const allowed = await this.permissions.can(membership, resourceForType(c.entityType), 'VIEW');
      if (!allowed) continue;
      if (c.confidentialityLevel === 'STRICTLY_CONFIDENTIAL' && !canConfidential) continue;
      visible.push(c);
    }
    return visible;
  }
}
