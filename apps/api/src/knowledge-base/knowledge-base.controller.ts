import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { EntitiesService } from '../entities/entities.service';
import { CreateArticleDto, UpdateArticleDto } from './dto/article.dto';

/**
 * Семейная база знаний реализована как специализация универсального Entity
 * (entityType='knowledge_article'), а не отдельной таблицей — переиспользуются
 * версионирование, файлы, связи и права доступа общего движка.
 */
@UseGuards(JwtAuthGuard)
@Controller('knowledge-base/articles')
export class KnowledgeBaseController {
  constructor(private readonly entities: EntitiesService) {}

  @Post()
  create(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Body() dto: CreateArticleDto) {
    return this.entities.create(userId, familySpaceId, {
      entityType: 'knowledge_article',
      title: dto.title,
      attributes: { content: dto.content, folder: dto.folder ?? 'Общее', tags: dto.tags ?? [] },
      changeSummary: dto.changeSummary,
    });
  }

  @Get()
  list(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Query('status') status?: string,
  ) {
    return this.entities.list(userId, familySpaceId, { entityType: 'knowledge_article', status });
  }

  @Get(':id')
  findOne(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.entities.findOne(userId, familySpaceId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateArticleDto,
  ) {
    const attributes: Record<string, unknown> = {};
    if (dto.content !== undefined) attributes.content = dto.content;
    if (dto.folder !== undefined) attributes.folder = dto.folder;
    if (dto.tags !== undefined) attributes.tags = dto.tags;
    return this.entities.update(userId, familySpaceId, id, {
      title: dto.title,
      attributes,
      changeSummary: dto.changeSummary,
    });
  }

  @Get(':id/versions')
  versions(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.entities.listVersions(userId, familySpaceId, id);
  }

  @Post(':id/revert')
  revert(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('id') id: string,
    @Body('versionNumber') versionNumber: number,
  ) {
    return this.entities.revert(userId, familySpaceId, id, { versionNumber });
  }

  @Patch(':id/archive')
  archive(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.entities.setStatus(userId, familySpaceId, id, 'ARCHIVED');
  }
}
