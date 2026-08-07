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

@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly service: FilesService) {}

  @Get()
  list(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string) {
    return this.service.listForFamilySpace(userId, familySpaceId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
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
  @UseInterceptors(FileInterceptor('file'))
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
