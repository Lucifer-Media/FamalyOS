import { Body, Controller, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { FinanceImportService } from './finance-import.service';
import { ConfirmImportDto } from './dto/confirm-import.dto';

const MAX_STATEMENT_SIZE_BYTES = 50 * 1024 * 1024;

@UseGuards(JwtAuthGuard)
@Controller('finance')
export class FinanceController {
  constructor(private readonly service: FinanceImportService) {}

  @Post('import/:accountEntityId/parse')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_STATEMENT_SIZE_BYTES } }))
  parseStatement(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('accountEntityId') accountEntityId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.parseFile(userId, familySpaceId, accountEntityId, file.originalname, file.mimetype, file.buffer);
  }

  @Post('import/confirm')
  confirmImport(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Body() dto: ConfirmImportDto,
  ) {
    return this.service.confirmImport(userId, familySpaceId, dto.accountEntityId, dto.transactions as any);
  }

  @Get('reconciliation/:documentEntityId')
  getReconciliationCandidates(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('documentEntityId') documentEntityId: string,
  ) {
    return this.service.findReconciliationCandidatesForDocument(userId, familySpaceId, documentEntityId);
  }

  @Post('reconciliation/:documentEntityId/link/:transactionEntityId')
  linkReconciliation(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('documentEntityId') documentEntityId: string,
    @Param('transactionEntityId') transactionEntityId: string,
  ) {
    return this.service.linkDocumentToTransaction(userId, familySpaceId, documentEntityId, transactionEntityId);
  }
}
