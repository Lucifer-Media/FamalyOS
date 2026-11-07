import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { FinanceAutomationService, CleanupFilter } from './finance-automation.service';
import { FinanceAiService } from './finance-ai.service';

/**
 * Итерация 4 — правила, подписки, копилки, очистка, ИИ.
 * Обычный CRUD (список правил/копилок/отчётов, архивирование, история
 * версий) — через общий /entities; здесь только то, что требует логики.
 */
@UseGuards(JwtAuthGuard)
@Controller('finance')
export class FinanceAutomationController {
  constructor(
    private readonly automation: FinanceAutomationService,
    private readonly ai: FinanceAiService,
  ) {}

  // ---------- Правила ----------
  @Post('rules')
  saveRule(@CurrentUser() userId: string, @FamilySpaceId() fs: string, @Body() dto: { id?: string; attributes: Record<string, unknown> }) {
    return this.automation.saveRule(userId, fs, dto);
  }

  @Post('rules/apply')
  applyRules(
    @CurrentUser() userId: string,
    @FamilySpaceId() fs: string,
    @Body() dto: { dryRun?: boolean; ruleIds?: string[]; onlyEmpty?: boolean; draftRule?: Record<string, unknown>; limit?: number },
  ) {
    return this.automation.applyRulesToExisting(userId, fs, dto);
  }

  // ---------- Регулярные платежи ----------
  @Get('recurring/candidates')
  recurringCandidates(@CurrentUser() userId: string, @FamilySpaceId() fs: string) {
    return this.automation.getRecurringCandidates(userId, fs);
  }

  @Get('recurring/status')
  needsStatus(@CurrentUser() userId: string, @FamilySpaceId() fs: string, @Query('month') month?: string) {
    return this.automation.getNeedsStatus(userId, fs, month);
  }

  @Post('recurring/track')
  trackCandidate(
    @CurrentUser() userId: string,
    @FamilySpaceId() fs: string,
    @Body() dto: { name: string; amount: number; currency?: string; matchPattern: string; period: string; categoryId?: string; nextDueDate?: string; isSubscription?: boolean },
  ) {
    return this.automation.createNeedFromCandidate(userId, fs, dto);
  }

  // ---------- Копилки ----------
  @Get('goals/summary')
  goalsSummary(@CurrentUser() userId: string, @FamilySpaceId() fs: string) {
    return this.automation.getGoalsSummary(userId, fs);
  }

  @Get('goals/:goalId/contributions')
  goalContributions(@CurrentUser() userId: string, @FamilySpaceId() fs: string, @Param('goalId') goalId: string) {
    return this.automation.listContributions(userId, fs, goalId);
  }

  @Post('goals/:goalId/contributions')
  addContribution(
    @CurrentUser() userId: string,
    @FamilySpaceId() fs: string,
    @Param('goalId') goalId: string,
    @Body() dto: { amount: number; date?: string; accountId?: string; note?: string },
  ) {
    return this.automation.addContribution(userId, fs, goalId, dto);
  }

  // ---------- Очистка (архивирование) ----------
  @Post('cleanup/preview')
  cleanupPreview(@CurrentUser() userId: string, @FamilySpaceId() fs: string, @Body() dto: CleanupFilter) {
    return this.automation.cleanupPreview(userId, fs, dto);
  }

  @Post('cleanup/archive')
  cleanupArchive(@CurrentUser() userId: string, @FamilySpaceId() fs: string, @Body() dto: CleanupFilter & { confirmCount: number }) {
    return this.automation.cleanupArchive(userId, fs, dto);
  }

  // ---------- ИИ ----------
  @Get('ai/status')
  aiStatus(@CurrentUser() userId: string, @FamilySpaceId() fs: string) {
    return this.ai.getStatus(userId, fs);
  }

  @Get('ai/facts')
  aiFacts(@CurrentUser() userId: string, @FamilySpaceId() fs: string, @Query('startDate') s: string, @Query('endDate') e: string) {
    return this.ai.previewFacts(userId, fs, s, e);
  }

  @Post('ai/reports')
  createReport(@CurrentUser() userId: string, @FamilySpaceId() fs: string, @Body() dto: { periodStart: string; periodEnd: string; useAi?: boolean }) {
    return this.ai.createReport(userId, fs, dto);
  }

  @Post('ai/reports/:id/regenerate')
  regenerate(@CurrentUser() userId: string, @FamilySpaceId() fs: string, @Param('id') id: string) {
    return this.ai.regenerate(userId, fs, id);
  }

  @Post('ai/ask')
  ask(@CurrentUser() userId: string, @FamilySpaceId() fs: string, @Body() dto: { question: string; periodStart: string; periodEnd: string }) {
    return this.ai.ask(userId, fs, dto);
  }

  @Post('ai/categorize/suggest')
  suggestCategories(@CurrentUser() userId: string, @FamilySpaceId() fs: string, @Body() dto: { limit?: number }) {
    return this.ai.suggestCategories(userId, fs, dto ?? {});
  }

  @Post('ai/categorize/apply')
  applyCategories(@CurrentUser() userId: string, @FamilySpaceId() fs: string, @Body() dto: { items: { transactionId: string; categoryId: string }[] }) {
    return this.ai.applyCategorySuggestions(userId, fs, dto.items);
  }
}
