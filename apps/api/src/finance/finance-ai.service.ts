import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { AuditService } from '../audit/audit.service';
import { EntitiesService } from '../entities/entities.service';
import { OllamaService } from '../ai-assistant/ollama.service';
import { isActualTransaction } from './finance-analytics.service';
import { FinanceAutomationService } from './finance-automation.service';
import { PortfolioService } from './portfolio.service';
import {
  buildReportFacts,
  buildReportPrompt,
  buildQuestionPrompt,
  buildFallbackNarrative,
  findUnverifiedNumbers,
  FactTx,
  ReportFacts,
} from './finance-report-facts';
import { buildCategorizePrompt, parseCategorizeResponse, CategorizeTx } from './ai-categorize';

type Attrs = Record<string, unknown>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Генерация отчёта на CPU ноутбука может идти минуты — отдельный, более длинный таймаут. */
const REPORT_TIMEOUT_MS = Number(process.env.LLM_REPORT_TIMEOUT_MS || 300000);

function endpointLabel(ep: { role: string; model: string; url: string }) {
  return `${ep.model} (${ep.role === 'primary' ? 'основная' : 'резервная'}, ${ep.url.replace(/^https?:\/\//, '')})`;
}

/**
 * ИИ в финансах (Итерация 4): отчёты, вопросы по финансам, подсказки
 * категорий. Принцип: цифры считает код (buildReportFacts), модель только
 * формулирует; ответ модели проверяется на «чужие» числа.
 */
@Injectable()
export class FinanceAiService {
  private readonly logger = new Logger(FinanceAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly entities: EntitiesService,
    private readonly llm: OllamaService,
    private readonly automation: FinanceAutomationService,
    private readonly portfolio: PortfolioService,
  ) {}

  private async assert(userId: string, familySpaceId: string, action: 'VIEW' | 'CREATE' | 'EDIT') {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FINANCE', action);
  }

  async getStatus(userId: string, familySpaceId: string) {
    await this.assert(userId, familySpaceId, 'VIEW');
    return { configured: this.llm.isConfigured(), endpoints: await this.llm.status() };
  }

  /** Собирает все факты периода — общий шаг для отчёта и вопроса. */
  async buildFacts(userId: string, familySpaceId: string, periodStart: string, periodEnd: string): Promise<{ facts: ReportFacts; otherCurrencyCount: number }> {
    if (!DATE_RE.test(periodStart) || !DATE_RE.test(periodEnd) || periodStart > periodEnd) {
      throw new BadRequestException('Период задан неверно (ГГГГ-ММ-ДД, начало ≤ конца)');
    }
    const space = await this.prisma.familySpace.findUnique({ where: { id: familySpaceId } });
    const currency = space?.baseCurrency ?? 'RUB';

    const [txs, categories, budgets, accountRows, banks, people] = await Promise.all([
      this.automation.loadActiveTransactions(familySpaceId),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'financial_category' }, select: { id: true, title: true, attributes: true } }),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'budget', status: 'ACTIVE' }, select: { id: true, attributes: true } }),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'bank_account', status: 'ACTIVE' }, select: { title: true, ownerPersonId: true, attributes: true } }),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'bank' }, select: { id: true, title: true, attributes: true } }),
      this.prisma.person.findMany({ where: { familySpaceId }, select: { id: true, fullName: true } }),
    ]);
    const bankName = new Map(((banks ?? []) as { id: string; title: string; attributes: unknown }[]).map((b) => [b.id, String(((b.attributes ?? {}) as Attrs).name ?? b.title)]));
    const personName = new Map(((people ?? []) as { id: string; fullName: string }[]).map((p) => [p.id, p.fullName]));
    const accounts: ReportFacts['accounts'] = ((accountRows ?? []) as { title: string; ownerPersonId?: string | null; attributes: unknown }[]).map((r) => {
      const a = (r.attributes ?? {}) as Attrs;
      return {
        name: String(a.accountName || r.title),
        bank: (a.bankId ? bankName.get(String(a.bankId)) : undefined) ?? (a.bankName as string | undefined),
        balance: typeof a.currentBalance === 'number' ? a.currentBalance : null,
        currency: String(a.currency ?? 'RUB'),
        owner: a.isShared === true || !r.ownerPersonId ? 'общий' : personName.get(r.ownerPersonId),
      };
    });

    const categoryNames: Record<string, string> = {};
    for (const c of categories as { id: string; title: string; attributes: unknown }[]) {
      categoryNames[c.id] = String(((c.attributes ?? {}) as Attrs).name ?? c.title);
    }

    let otherCurrencyCount = 0;
    const factTxs: FactTx[] = [];
    for (const t of txs) {
      const a = t.attributes;
      if (!isActualTransaction(a)) continue;
      if (a.currency && a.currency !== currency) {
        if (String(a.date ?? '') >= periodStart && String(a.date ?? '') <= periodEnd) otherCurrencyCount++;
        continue;
      }
      factTxs.push({
        id: t.id,
        date: String(a.date ?? ''),
        amount: Number(a.amount) || 0,
        description: a.description as string | undefined,
        counterparty: a.counterparty as string | undefined,
        categoryId: a.categoryId as string | undefined,
        accountId: a.accountId as string | undefined,
        transactionType: a.transactionType as string | undefined,
        scope: a.scope as string | undefined,
      });
    }

    // Бюджеты: те, что пересекаются с периодом; факт — по категории за период отчёта.
    const budgetFacts: ReportFacts['budgets'] = [];
    for (const b of budgets as { id: string; attributes: unknown }[]) {
      const a = (b.attributes ?? {}) as Attrs;
      const bStart = String(a.startDate ?? '');
      const bEnd = String(a.endDate ?? '9999-12-31');
      if (bStart > periodEnd || bEnd < periodStart) continue;
      const planned = Number(a.plannedExpense) || 0;
      const categoryId = a.categoryId as string | undefined;
      if (!planned || !categoryId) continue;
      const spent = factTxs
        .filter((t) => t.categoryId === categoryId && t.amount < 0 && t.transactionType !== 'TRANSFER' && t.date >= periodStart && t.date <= periodEnd)
        .reduce((s, t) => s - t.amount, 0);
      budgetFacts.push({ name: String(a.budgetName ?? 'Бюджет'), planned, spent: Math.round(spent * 100) / 100, percentUsed: Math.round((spent / planned) * 1000) / 10 });
    }

    const month = periodEnd.slice(0, 7);
    const [needs, goals, netWorth] = await Promise.all([
      this.automation.getNeedsStatus(userId, familySpaceId, month).catch(() => null),
      this.automation.getGoalsSummary(userId, familySpaceId).catch(() => [] as Awaited<ReturnType<FinanceAutomationService['getGoalsSummary']>>),
      this.portfolio.getNetWorth(userId, familySpaceId).catch(() => null),
    ]);

    const facts = buildReportFacts({
      periodStart,
      periodEnd,
      currency,
      transactions: factTxs,
      categoryNames,
      budgets: budgetFacts,
      needs: (needs?.items ?? []).map((n) => ({ name: n.name, status: n.status, planned: n.plannedAmount, paid: n.paidAmount })),
      goals: goals
        .filter((g) => g.entityStatus === 'ACTIVE')
        .map((g) => ({ name: g.name, saved: g.savedAmount, target: g.targetAmount, percent: g.percent, estimatedDate: g.estimatedDate })),
      netWorth: netWorth?.netWorth ?? null,
      accounts,
    });
    return { facts, otherCurrencyCount };
  }

  async previewFacts(userId: string, familySpaceId: string, periodStart: string, periodEnd: string) {
    await this.assert(userId, familySpaceId, 'VIEW');
    return this.buildFacts(userId, familySpaceId, periodStart, periodEnd);
  }

  /**
   * Создаёт запись отчёта со статусом GENERATING и сразу возвращает её;
   * факты считаются синхронно (быстро), текст ИИ — в фоне. Страница
   * опрашивает GET /finance/ai/reports/:id. Так ноутбуку на CPU не нужно
   * укладываться в таймаут HTTP-запроса.
   */
  async createReport(userId: string, familySpaceId: string, dto: { periodStart: string; periodEnd: string; useAi?: boolean }) {
    await this.assert(userId, familySpaceId, 'CREATE');
    const { facts, otherCurrencyCount } = await this.buildFacts(userId, familySpaceId, dto.periodStart, dto.periodEnd);
    const useAi = dto.useAi !== false && this.llm.isConfigured();
    const warnings: string[] = [];
    if (otherCurrencyCount) warnings.push(`Операции в другой валюте (${otherCurrencyCount} шт.) в отчёт не вошли — считается только ${facts.currency}.`);
    if (facts.transactionCount === 0) warnings.push('За период нет операций.');

    const report = await this.entities.create(userId, familySpaceId, {
      entityType: 'finance_report',
      title: `Финансовый отчёт ${dto.periodStart} — ${dto.periodEnd}`,
      attributes: {
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
        reportStatus: useAi ? 'GENERATING' : 'READY',
        generator: useAi ? undefined : 'TEMPLATE',
        narrative: useAi ? undefined : buildFallbackNarrative(facts),
        facts,
        warnings,
      },
      changeSummary: 'Формирование финансового отчёта',
    });

    if (useAi) {
      // Фоновая генерация — ошибки не должны уронить процесс.
      void this.generateNarrative(userId, familySpaceId, report.id, facts, warnings).catch((err) =>
        this.logger.error(`Отчёт ${report.id}: ${(err as Error).message}`),
      );
    }
    return report;
  }

  private async generateNarrative(userId: string, familySpaceId: string, reportId: string, facts: ReportFacts, warnings: string[]) {
    const started = Date.now();
    const result = await this.llm.complete(buildReportPrompt(facts), { timeoutMs: REPORT_TIMEOUT_MS });
    const nextWarnings = [...warnings];
    let attributes: Attrs;
    if (!result || !result.text.trim()) {
      nextWarnings.push('ИИ не ответил ни на одном адресе — текст составлен по шаблону.');
      attributes = { reportStatus: 'READY', generator: 'TEMPLATE', narrative: buildFallbackNarrative(facts), warnings: nextWarnings };
    } else {
      const unverified = findUnverifiedNumbers(result.text, facts);
      if (unverified.length) nextWarnings.push(`ИИ упомянул числа, которых нет в расчётах: ${unverified.join(', ')} — перепроверьте эти места.`);
      attributes = {
        reportStatus: 'READY',
        generator: 'AI',
        modelUsed: endpointLabel(result.endpoint),
        narrative: result.text,
        unverifiedNumbers: unverified,
        generationMs: Date.now() - started,
        warnings: nextWarnings,
      };
    }
    await this.entities.update(userId, familySpaceId, reportId, { attributes, changeSummary: 'Текст отчёта сформирован' });
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'finance.report_generated',
      resourceType: 'finance_report',
      resourceId: reportId,
      metadata: { generator: attributes.generator, model: attributes.modelUsed ?? null, ms: Date.now() - started },
    });
  }

  async regenerate(userId: string, familySpaceId: string, reportId: string) {
    const report = await this.entities.findOne(userId, familySpaceId, reportId);
    if (report.entityType !== 'finance_report') throw new NotFoundException('Отчёт не найден');
    const a = (report.attributes ?? {}) as Attrs;
    const { facts, otherCurrencyCount } = await this.buildFacts(userId, familySpaceId, String(a.periodStart), String(a.periodEnd));
    const warnings = otherCurrencyCount ? [`Операции в другой валюте (${otherCurrencyCount} шт.) в отчёт не вошли.`] : [];
    await this.entities.update(userId, familySpaceId, reportId, {
      attributes: { reportStatus: 'GENERATING', facts, warnings },
      changeSummary: 'Пересчёт отчёта',
    });
    void this.generateNarrative(userId, familySpaceId, reportId, facts, warnings).catch((err) => this.logger.error((err as Error).message));
    return { id: reportId, reportStatus: 'GENERATING' };
  }

  /** Вопрос ИИ про финансы за период — синхронно (короткий ответ). */
  async ask(userId: string, familySpaceId: string, dto: { question: string; periodStart: string; periodEnd: string }) {
    await this.assert(userId, familySpaceId, 'VIEW');
    if (!dto.question?.trim()) throw new BadRequestException('Пустой вопрос');
    const { facts } = await this.buildFacts(userId, familySpaceId, dto.periodStart, dto.periodEnd);
    if (!this.llm.isConfigured()) return { answer: null, unavailable: true, facts, unverifiedNumbers: [] as string[] };
    const result = await this.llm.complete(buildQuestionPrompt(dto.question, facts), { timeoutMs: REPORT_TIMEOUT_MS });
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'finance.ai_question',
      resourceType: 'finance_report',
      metadata: { period: `${dto.periodStart}..${dto.periodEnd}`, answered: Boolean(result), model: result?.endpoint.model ?? null },
    });
    if (!result) return { answer: null, unavailable: true, facts, unverifiedNumbers: [] as string[] };
    return {
      answer: result.text,
      unavailable: false,
      model: endpointLabel(result.endpoint),
      unverifiedNumbers: findUnverifiedNumbers(result.text, facts),
      facts,
    };
  }

  /** ИИ-подсказки категорий для операций без категории. Ничего не сохраняет. */
  async suggestCategories(userId: string, familySpaceId: string, dto: { limit?: number }) {
    await this.assert(userId, familySpaceId, 'VIEW');
    const [txs, categories] = await Promise.all([
      this.automation.loadActiveTransactions(familySpaceId),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'financial_category', status: 'ACTIVE' }, select: { id: true, title: true, attributes: true } }),
    ]);
    const cats = (categories as { id: string; title: string; attributes: unknown }[]).map((c) => ({
      id: c.id,
      name: String(((c.attributes ?? {}) as Attrs).name ?? c.title),
    }));
    if (cats.length === 0) return { unavailable: false, suggestions: [], note: 'Сначала заведите категории' };

    const limit = Math.min(Math.max(dto.limit ?? 30, 1), 60);
    const pending = txs
      .filter((t) => !t.attributes.categoryId && t.attributes.transactionType !== 'TRANSFER' && isActualTransaction(t.attributes))
      .sort((a, b) => (String(a.attributes.date) < String(b.attributes.date) ? 1 : -1))
      .slice(0, limit);
    if (pending.length === 0) return { unavailable: false, suggestions: [] };

    const items: CategorizeTx[] = pending.map((t) => ({
      id: t.id,
      description: t.attributes.description as string | undefined,
      counterparty: t.attributes.counterparty as string | undefined,
      amount: Number(t.attributes.amount) || 0,
      mcc: t.attributes.mcc as string | undefined,
    }));
    const result = await this.llm.complete(buildCategorizePrompt(items, cats.map((c) => c.name)), { json: true, timeoutMs: REPORT_TIMEOUT_MS });
    if (!result) return { unavailable: true, suggestions: [] };
    const suggestions = parseCategorizeResponse(result.text, items, cats).map((s) => {
      const tx = pending.find((p) => p.id === s.transactionId)!;
      return {
        ...s,
        date: tx.attributes.date,
        description: tx.attributes.description ?? tx.attributes.counterparty ?? '',
        counterparty: tx.attributes.counterparty,
        amount: tx.attributes.amount,
      };
    });
    return { unavailable: false, model: endpointLabel(result.endpoint), suggestions };
  }

  /** Применение подтверждённых пользователем подсказок. */
  async applyCategorySuggestions(userId: string, familySpaceId: string, items: { transactionId: string; categoryId: string }[]) {
    await this.assert(userId, familySpaceId, 'EDIT');
    let applied = 0;
    for (const it of items ?? []) {
      if (!it.transactionId || !it.categoryId) continue;
      await this.entities.update(userId, familySpaceId, it.transactionId, {
        attributes: { categoryId: it.categoryId },
        changeSummary: 'Категория по подсказке ИИ (подтверждено пользователем)',
      });
      applied++;
    }
    await this.audit.log({ familySpaceId, actorUserId: userId, action: 'finance.ai_categories_applied', resourceType: 'financial_transaction', metadata: { applied } });
    return { applied };
  }
}
