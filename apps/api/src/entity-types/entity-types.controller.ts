import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ENTITY_TYPE_REGISTRY, getEntityTypeSchema } from './entity-type-registry';

/**
 * Отдаёт декларативные схемы типов сущностей фронтенду, чтобы формы
 * строились по ОДНОМУ источнику правды (этому реестру), а не по дублю
 * на клиенте, который легко рассинхронизировать при изменении полей.
 */
@UseGuards(JwtAuthGuard)
@Controller('entity-types')
export class EntityTypesController {
  @Get()
  list() {
    return Object.values(ENTITY_TYPE_REGISTRY);
  }

  @Get(':type')
  get(@Param('type') type: string) {
    return getEntityTypeSchema(type) ?? null;
  }
}
