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
  ) {
    return this.service.createFromUploadedFile(userId, familySpaceId, fileId);
  }

  @Get()
  list(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Query('status') status?: string) {
    return this.service.list(userId, familySpaceId, status);
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
}
