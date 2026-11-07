import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { AuditService } from '../audit/audit.service';
import { EntitiesService } from '../entities/entities.service';
import { OllamaService } from '../ai-assistant/ollama.service';
import { isActualTransaction } from './finance-analytics.service';
import { FinanceAutomationService } from './finance-automation.service';
import { computePlan, buildCategoryForecasts, lastFullMonths, PlanInput, PlanningResult, WATCH_CATEGORY_HINTS, MonthFlow } from './finance-planning';
import { collectFactNumbers } from './finance-report-facts';

type Attrs = Record<string, unknown>;
const HISTORY_MONTHS = 6;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export interface PlanningFilter {
  scope?: 'PERSONAL' | 'FAMILY';
  ownerPersonId?: string;
  capacityOverride?: number | null;
}

/**
 * Финансовое планирование (Итерация 4.1): «сколько откладывать на врачей,
 * отпуск и прочее с учётом всех планов». Данные собираются здесь, расчёт —
 * в чистом finance-planning.ts.
 */
@Injectable()
export class FinancePlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly entities: EntitiesService,
    private readonly llm: OllamaService,
    private readonly automation: FinanceAutomationService,
  ) {}

  async getPlan(userId: string, familySpaceId: string, filter: PlanningFilter = {}, today = todayIso()): Promise<PlanningResult & { currency: string }> {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FINANCE', 'VIEW');

    const space = await this.prisma.familySpace.findUnique({ where: { id: familySpaceId } });
    const currency = space?.baseCurrency ?? 'RUB';
    const months = lastFullMonths(today, HISTORY_MONTHS);
    const firstMonth = months[0];

    const [txs, categories, goals, goalSummaries, people] = await Promise.all([
      this.automation.loadActiveTransactions(familySpaceId),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'financial_category' }, select: { id: true, title: true, attributes: true } }),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'financial_goal', status: 'ACTIVE' }, select: { id: true, title: true, ownerPersonId: true, attributes: true } }),
      this.automation.getGoalsSummary(userId, familySpaceId),
      this.prisma.person.findMany({ where: { familySpaceId }, select: { id: true, fullName: true } }),
    ]);

    const catName: Record<string, string> = {};
    for (const c of categories as { id: string; title: string; attributes: unknown }[]) catName[c.id] = String(((c.attributes ?? {}) as Attrs).name ?? c.title);
    const personName = new Map((people as { id: string; fullName: string }[]).map((p) => [p.id, p.fullName]));
    const savedByGoal = new Map(goalSummaries.map((g) => [g.goalId, g.savedAmount]));

    // История по месяцам (полные месяцы, базовая валюта, без переводов и плановых).
    const flows = new Map<string, MonthFlow>(months.map((m) => [m, { month: m, income: 0, expense: 0 }]));
    const byCategory: Record<string, { name: string; months: Record<string, number> }> = {};
    for (const t of txs) {
      const a = t.attributes;
      if (!isActualTransaction(a) || a.transactionType === 'TRANSFER') continue;
      if (a.currency && a.currency !== currency) continue;
      const m = String(a.date ?? '').slice(0, 7);
      if (m < firstMonth || !flows.has(m)) continue;
      const amount = Number(a.amount) || 0;
      const f = flows.get(m)!;
      if (amount >= 0) f.income += amount;
      else {
        f.expense += -amount;
        const cid = a.categoryId as string | undefined;
        if (cid) {
          byCategory[cid] ??= { name: catName[cid] ?? 'Категория', months: {} };
          byCategory[cid].months[m] = (byCategory[cid].months[m] ?? 0) + -amount;
        }
      }
    }

    // Планы
    const plans: PlanInput[] = [];
    for (const g of goals as { id: string; title: string; ownerPersonId: string | null; attributes: unknown }[]) {
      const a = (g.attributes ?? {}) as Attrs;
      if (a.status === 'COMPLETED' || a.status === 'PAUSED') continue;
      const scope = a.scope === 'PERSONAL' ? 'PERSONAL' : 'FAMILY';
      if (filter.scope && filter.scope !== scope) continue;
      if (filter.ownerPersonId && g.ownerPersonId !== filter.ownerPersonId) continue;
      const kind = a.planKind === 'RECURRING' || a.planKind === 'OPEN' ? a.planKind : 'TARGET';
      const categoryId = (a.linkedCategoryId as string) || undefined;
      plans.push({
        id: g.id,
        name: String(a.name ?? g.title),
        kind,
        scope,
        ownerName: g.ownerPersonId ? personName.get(g.ownerPersonId) : undefined,
        priority: Math.min(5, Math.max(1, Number(a.priority) || 3)),
        targetAmount: Number(a.targetAmount) || 0,
        savedAmount: savedByGoal.get(g.id) ?? 0,
        deadline: (a.deadline as string) || undefined,
        nextDate: (a.nextDate as string) || undefined,
        recurrenceMonths: Number(a.recurrenceMonths) || undefined,
        plannedMonthly: Number(a.plannedMonthly) || undefined,
        categoryId,
        categoryName: categoryId ? catName[categoryId] : undefined,
      });
    }

    const plannedCategoryIds = new Set(plans.map((p) => p.categoryId).filter((x): x is string => !!x));
    const forecasts = buildCategoryForecasts(byCategory, months, plannedCategoryIds);
    const watchCategoryIds = forecasts.filter((c) => WATCH_CATEGORY_HINTS.test(c.categoryName)).map((c) => c.categoryId);

    const result = computePlan({
      today,
      history: months.map((m) => flows.get(m)!),
      plans,
      categories: forecasts,
      capacityOverride: filter.capacityOverride,
      watchCategoryIds,
    });
    return { ...result, currency };
  }

  /** Быстро завести план (в т.ч. «резерв на врачей» из прогноза категории). */
  async createPlan(
    userId: string,
    familySpaceId: string,
    dto: {
      name: string;
      planKind: 'TARGET' | 'RECURRING' | 'OPEN';
      scope: 'PERSONAL' | 'FAMILY';
      ownerPersonId?: string;
      targetAmount?: number;
      deadline?: string;
      nextDate?: string;
      recurrenceMonths?: number;
      plannedMonthly?: number;
      priority?: number;
      categoryId?: string;
      icon?: string;
      startAmount?: number;
    },
  ) {
    if (!dto.name?.trim()) throw new BadRequestException('Укажите название плана');
    if (dto.planKind === 'TARGET' && !(Number(dto.targetAmount) > 0)) throw new BadRequestException('Для цели нужна сумма');
    if (dto.planKind === 'RECURRING' && (!(Number(dto.targetAmount) > 0) || !(Number(dto.recurrenceMonths) >= 1))) {
      throw new BadRequestException('Для резерва нужны сумма одной траты и периодичность в месяцах');
    }
    if (dto.planKind === 'OPEN' && !(Number(dto.plannedMonthly) > 0)) throw new BadRequestException('Для ежемесячного резерва нужна сумма в месяц');
    if (dto.scope === 'PERSONAL' && !dto.ownerPersonId) throw new BadRequestException('Для личного плана выберите, чей он');
    const target = dto.planKind === 'OPEN' ? Number(dto.plannedMonthly) * 12 : Number(dto.targetAmount);
    return this.entities.create(userId, familySpaceId, {
      entityType: 'financial_goal',
      title: dto.name.trim(),
      ownerPersonId: dto.scope === 'PERSONAL' ? dto.ownerPersonId : undefined,
      attributes: {
        name: dto.name.trim(),
        targetAmount: Math.round(target * 100) / 100,
        currency: 'RUB',
        status: 'ACTIVE',
        planKind: dto.planKind,
        scope: dto.scope,
        deadline: dto.planKind === 'TARGET' ? dto.deadline || undefined : undefined,
        nextDate: dto.planKind === 'RECURRING' ? dto.nextDate || undefined : undefined,
        recurrenceMonths: dto.planKind === 'RECURRING' ? Number(dto.recurrenceMonths) : undefined,
        plannedMonthly: dto.plannedMonthly ? Number(dto.plannedMonthly) : undefined,
        priority: Math.min(5, Math.max(1, Number(dto.priority) || 3)),
        linkedCategoryId: dto.categoryId || undefined,
        icon: dto.icon || undefined,
        startAmount: dto.startAmount ? Number(dto.startAmount) : undefined,
        trackingMode: 'CONTRIBUTIONS',
      },
      changeSummary: 'Создание плана',
    });
  }

  /** ИИ объясняет план: факты считает код, модель только пересказывает и советует. */
  async explain(userId: string, familySpaceId: string, filter: PlanningFilter = {}, question?: string) {
    const plan = await this.getPlan(userId, familySpaceId, filter);
    if (!this.llm.isConfigured()) return { answer: null, unavailable: true, unverifiedNumbers: [] as string[] };
    const compact = {
      свободно_в_месяц: plan.monthlyCapacity,
      источник: plan.capacitySource === 'OVERRIDE' ? 'задано вручную' : `медиана за ${plan.historyMonths} мес.`,
      медиана_доходов: plan.medianIncome,
      медиана_расходов: plan.medianExpense,
      нужно_на_планы: plan.totalRequired,
      остаётся_после_планов: plan.freeAfterPlans,
      планы: plan.plans.map((p) => ({
        план: p.name,
        чей: p.scope === 'PERSONAL' ? p.ownerName ?? 'личный' : 'общий',
        приоритет: p.priority,
        нужно_в_месяц: p.requiredMonthly,
        помещается: p.allocatedMonthly,
        успеваем: p.fits,
        срок: p.dueDate,
        прогноз_даты: p.projectedDate,
        осталось: p.remaining,
      })),
      категории: plan.categories.slice(0, 8).map((c) => ({ категория: c.categoryName, среднее_в_месяц: c.averageMonthly, прогноз: c.forecastNextMonth, тренд_процент: c.trendPercent, есть_резерв: c.hasPlan })),
      подсказки_системы: plan.suggestions.map((s) => s.text),
    };
    const prompt = [
      'Ты — финансовый помощник семьи в Family OS. Ниже — уже посчитанный кодом финансовый план.',
      'ПРАВИЛА: используй только числа из ДАННЫХ, ничего не пересчитывай; пиши по-русски, коротко, по делу; не давай общих советов из интернета.',
      question?.trim()
        ? `Ответь на вопрос: ${question.trim().slice(0, 500)}`
        : 'Напиши: 1) получается ли всё успеть; 2) что сдвигается и почему; 3) 2–4 конкретных шага (что отложить, что урезать, какой срок сдвинуть).',
      '',
      'ДАННЫЕ:',
      JSON.stringify(compact),
    ].join('\n');
    const result = await this.llm.complete(prompt, { timeoutMs: Number(process.env.LLM_REPORT_TIMEOUT_MS || 300000) });
    await this.audit.log({ familySpaceId, actorUserId: userId, action: 'finance.planning_ai', resourceType: 'financial_goal', metadata: { answered: Boolean(result), model: result?.endpoint.model ?? null } });
    if (!result) return { answer: null, unavailable: true, unverifiedNumbers: [] as string[] };
    const known = collectFactNumbers(plan);
    const unverified = findUnknownNumbers(result.text, known);
    return { answer: result.text, unavailable: false, model: result.endpoint.model, unverifiedNumbers: unverified };
  }
}

/** Та же проверка, что в отчётах, но по произвольному набору известных чисел. */
export function findUnknownNumbers(text: string, known: number[]): string[] {
  const out: string[] = [];
  const re = /(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,](\d+))?\s*(тыс\.?|млн\.?)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let num = Number(m[1].replace(/[   ]/g, '') + (m[2] ? '.' + m[2] : ''));
    const unit = (m[3] || '').toLowerCase();
    if (unit.startsWith('тыс')) num *= 1000;
    if (unit.startsWith('млн')) num *= 1e6;
    if (!Number.isFinite(num) || num < 100) continue;
    if (!unit && !m[2] && num >= 1900 && num <= 2100) continue;
    const prev = text[m.index - 1];
    if (prev === '-' || prev === '.' || prev === '/') continue;
    const tol = unit ? 0.05 : 0.01;
    if (!known.some((k) => Math.abs(k - num) <= Math.max(1, k * tol)) && !out.includes(m[0].trim())) out.push(m[0].trim());
  }
  return out.slice(0, 10);
}
