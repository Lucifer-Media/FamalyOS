import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { EntitiesService } from '../entities/entities.service';
import { getEntityTypeSchema } from '../entity-types/entity-type-registry';
import { CreatePassportChildRecordDto, CreatePassportRfDto, UpdatePassportRfDto } from './dto/passport-rf.dto';

/**
 * Паспорт РФ — первая специализированная карточка Итерации 2 и самая
 * сложная (раздел 6 ТЗ): регистрации, браки, дети — ОТДЕЛЬНЫЕ дочерние
 * сущности (через Entity.parentEntityId), а не вложенный JSON-массив,
 * потому что у каждой такой записи собственный жизненный цикл, версии и
 * дата актуальности.
 */
@UseGuards(JwtAuthGuard)
@Controller('documents/passport-rf')
export class PassportRfController {
  constructor(private readonly entities: EntitiesService) {}

  @Post()
  create(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Body() dto: CreatePassportRfDto,
  ) {
    const fullName = (dto.attributes?.fullName as string) ?? 'Паспорт РФ';
    return this.entities.create(userId, familySpaceId, {
      entityType: 'passport_rf',
      title: `Паспорт РФ — ${fullName}`,
      attributes: dto.attributes,
      ownerPersonId: dto.ownerPersonId,
      confidentialityLevel: 'SENSITIVE',
    });
  }

  @Get(':id')
  get(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.entities.findOne(userId, familySpaceId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePassportRfDto,
  ) {
    return this.entities.update(userId, familySpaceId, id, {
      attributes: dto.attributes,
      changeSummary: dto.changeSummary,
    });
  }

  @Get(':id/versions')
  versions(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.entities.listVersions(userId, familySpaceId, id);
  }

  // ---------- Вложенные записи: регистрации / браки / дети ----------

  @Post(':id/child-records')
  async createChildRecord(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('id') passportId: string,
    @Body() dto: CreatePassportChildRecordDto,
  ) {
    const passportSchema = getEntityTypeSchema('passport_rf');
    if (!passportSchema?.childTypes?.includes(dto.childType)) {
      throw new BadRequestException(
        `Тип ${dto.childType} не является допустимой вложенной записью паспорта РФ`,
      );
    }
    const childSchema = getEntityTypeSchema(dto.childType);
    const title = childTitle(dto.childType, dto.attributes);

    return this.entities.create(userId, familySpaceId, {
      entityType: dto.childType,
      title,
      attributes: dto.attributes,
      parentEntityId: passportId,
      confidentialityLevel: 'SENSITIVE',
      changeSummary: `Добавлена запись: ${childSchema?.labelSingular ?? dto.childType}`,
    });
  }

  @Get(':id/child-records')
  listChildRecords(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('id') passportId: string,
  ) {
    return this.entities.listChildren(userId, familySpaceId, passportId);
  }
}

function childTitle(childType: string, attrs: Record<string, unknown>): string {
  switch (childType) {
    case 'passport_registration':
      return `Регистрация: ${attrs.address ?? '—'}`;
    case 'passport_marriage':
      return `Брак: ${attrs.spouseFullName ?? '—'}`;
    case 'passport_child_record':
      return `Ребёнок: ${attrs.childFullName ?? '—'}`;
    default:
      return childType;
  }
}
