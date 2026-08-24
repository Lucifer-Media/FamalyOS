import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { FinanceImportService } from './finance-import.service';
import { FinanceAnalyticsService } from './finance-analytics.service';
import { ConfirmImportDto } from './dto/confirm-import.dto';

const MAX_STATEMENT_SIZE_BYTES = 50 * 1024 * 1024;

@UseGuards(JwtAuthGuard)
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly service: FinanceImportService,
    private readonly analytics: FinanceAnalyticsService,
  ) {}

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

  // ---------- Аналитика и бюджеты ----------

  @Get('analytics/by-category')
  getAnalyticsByCategory(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.analytics.getAnalyticsByCategory(userId, familySpaceId, startDate, endDate);
  }

  @Get('analytics/compare-previous')
  compareWithPreviousPeriod(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.analytics.compareWithPreviousPeriod(userId, familySpaceId, startDate, endDate);
  }

  @Get('budgets/:budgetId/status')
  getBudgetStatus(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('budgetId') budgetId: string,
  ) {
    return this.analytics.getBudgetStatus(userId, familySpaceId, budgetId);
  }
}
