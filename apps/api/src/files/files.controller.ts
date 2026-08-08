import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ConfidentialityLevel } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { FilesService } from './files.service';

// 100 МБ — раздел 22 ТЗ Итерации 2 явно называет этот размер как верхнюю
// границу для проверки. Без явного лимита Multer в Express может либо
// молча зависнуть на очень больших файлах, либо упасть с неинформативной
// ошибкой памяти — с лимитом клиент получает понятный HTTP 413.
const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;

@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly service: FilesService) {}

  @Get()
  list(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string) {
    return this.service.listForFamilySpace(userId, familySpaceId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_SIZE_BYTES } }))
  upload(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('confidentialityLevel') confidentialityLevel?: ConfidentialityLevel,
    @Body('entityId') entityId?: string,
    @Body('relationRole') relationRole?: string,
  ) {
    return this.service.upload(userId, familySpaceId, file, {
      confidentialityLevel,
      entityId,
      relationRole,
    });
  }

  @Get(':id')
  get(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.service.get(userId, familySpaceId, id);
  }

  @Get(':id/versions')
  versions(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.service.listVersions(userId, familySpaceId, id);
  }

  @Post(':id/versions')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_SIZE_BYTES } }))
  addVersion(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('changeNote') changeNote?: string,
  ) {
    return this.service.addVersion(userId, familySpaceId, id, file, changeNote);
  }

  @Get(':id/download')
  async download(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, file } = await this.service.readBuffer(userId, familySpaceId, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);
    res.send(buffer);
  }

  @Patch(':id/archive')
  archive(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.service.archive(userId, familySpaceId, id);
  }
}
