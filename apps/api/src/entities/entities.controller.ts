import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { EntitiesService } from './entities.service';
import { CreateEntityDto, CreateEntityLinkDto, RevertEntityDto, UpdateEntityDto } from './dto/entity.dto';

@UseGuards(JwtAuthGuard)
@Controller('entities')
export class EntitiesController {
  constructor(private readonly service: EntitiesService) {}

  @Post()
  create(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Body() dto: CreateEntityDto) {
    return this.service.create(userId, familySpaceId, dto);
  }

  @Get()
  list(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Query('entityType') entityType?: string,
    @Query('status') status?: string,
    @Query('ownerPersonId') ownerPersonId?: string,
    @Query('rootOnly') rootOnly?: string,
  ) {
    return this.service.list(userId, familySpaceId, {
      entityType,
      status,
      ownerPersonId,
      rootOnly: rootOnly === 'true',
    });
  }

  @Get(':id')
  findOne(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.service.findOne(userId, familySpaceId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEntityDto,
  ) {
    return this.service.update(userId, familySpaceId, id, dto);
  }

  @Patch(':id/archive')
  archive(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string, @Body('changeSummary') changeSummary?: string) {
    return this.service.setStatus(userId, familySpaceId, id, 'ARCHIVED', changeSummary);
  }

  @Patch(':id/unarchive')
  unarchive(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string, @Body('changeSummary') changeSummary?: string) {
    return this.service.setStatus(userId, familySpaceId, id, 'ACTIVE', changeSummary);
  }

  @Patch(':id/void')
  voidEntity(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string, @Body('changeSummary') changeSummary?: string) {
    return this.service.setStatus(userId, familySpaceId, id, 'VOID', changeSummary);
  }

  @Get(':id/versions')
  versions(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.service.listVersions(userId, familySpaceId, id);
  }

  @Post(':id/revert')
  revert(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('id') id: string,
    @Body() dto: RevertEntityDto,
  ) {
    return this.service.revert(userId, familySpaceId, id, dto);
  }

  @Post(':id/links')
  link(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('id') id: string,
    @Body() dto: CreateEntityLinkDto,
  ) {
    return this.service.link(userId, familySpaceId, id, dto);
  }

  @Get(':id/links')
  listLinks(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.service.listLinks(userId, familySpaceId, id);
  }

  @Get(':id/children')
  listChildren(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.service.listChildren(userId, familySpaceId, id);
  }
}
