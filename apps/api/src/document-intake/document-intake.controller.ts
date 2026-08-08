import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { DocumentIntakeService } from './document-intake.service';
import { ConfirmIntakeDto } from './dto/confirm-intake.dto';

@UseGuards(JwtAuthGuard)
@Controller('document-intake')
export class DocumentIntakeController {
  constructor(private readonly service: DocumentIntakeService) {}

  @Post('from-file/:fileId')
  createFromFile(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('fileId') fileId: string,
    @Query('targetEntityId') targetEntityId?: string,
  ) {
    return this.service.createFromUploadedFile(userId, familySpaceId, fileId, targetEntityId);
  }

  @Get()
  list(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Query('status') status?: string,
    @Query('confirmedEntityId') confirmedEntityId?: string,
  ) {
    return this.service.list(userId, familySpaceId, status, confirmedEntityId);
  }

  @Get(':id')
  get(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.service.get(userId, familySpaceId, id);
  }

  @Post(':id/confirm')
  confirm(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('id') id: string,
    @Body() dto: ConfirmIntakeDto,
  ) {
    return this.service.confirm(userId, familySpaceId, id, dto);
  }

  @Post(':id/reject')
  reject(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.service.reject(userId, familySpaceId, id);
  }

  @Post(':id/retry')
  retry(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.service.retry(userId, familySpaceId, id);
  }

  @Get(':id/pages')
  listPages(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.service.listPages(userId, familySpaceId, id);
  }

  @Post(':id/pages/:pageNumber/split')
  createIntakeFromPage(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('id') id: string,
    @Param('pageNumber') pageNumber: string,
  ) {
    return this.service.createIntakeFromPage(userId, familySpaceId, id, parseInt(pageNumber, 10));
  }
}
