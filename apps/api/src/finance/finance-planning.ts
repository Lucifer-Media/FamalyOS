/**
 * Финансовое планирование (Итерация 4.1). Чистая логика без Prisma.
 *
 * Идеи из референсов:
 *  - MoneyMatter (goals feasibility): «сколько реально можно откладывать» =
 *    МЕДИАНА чистого остатка (доходы − расходы) за последние полные месяцы
 *    (медиана, а не среднее — одна премия или один ремонт не ломают картину);
 *    цели финансируются по очереди, каждая «влезает», только если влезли все
 *    предыдущие.
 *  - Actual Budget (goal templates): резервы под повторяющиеся траты —
 *    «20 000 раз в 6 месяцев» → откладывать каждый месяц, к сроку собрано.
 *
 * Виды планов (financial_goal.planKind):
 *  - TARGET    — накопить сумму к дате (отпуск, операция у стоматолога);
 *  - RECURRING — резерв под регулярную трату: amount каждые N месяцев,
 *                ближайший срок nextDate (плановый осмотр, страховка);
 *  - OPEN      — ежемесячный лимит/резерв без даты (врачи ≈ 6 000 в месяц).
 *
 * Порядок финансирования: приоритет (1 — самый важный), затем ближайший срок.
 * Все суммы — в базовой валюте пространства.
 */

export type PlanKind = 'TARGET' | 'RECURRING' | 'OPEN';
export type PlanScope = 'PERSONAL' | 'FAMILY';

export interface PlanInput {
  id: string;
  name: string;
  kind: PlanKind;
  scope: PlanScope;
  ownerName?: string;
  priority: number; // 1..5, 1 — важнее
  targetAmount: number; // TARGET: цель; RECURRING: сумма одной траты; OPEN: не используется
  savedAmount: number;
  deadline?: string; // TARGET
  nextDate?: string; // RECURRING: дата ближайшей траты
  recurrenceMonths?: number; // RECURRING
  plannedMonthly?: number; // OPEN (и ручное переопределение для других видов)
  categoryId?: string;
  categoryName?: string;
}

export interface MonthFlow {
  month: string; // YYYY-MM
  income: number;
  expense: number;
}

export interface PlanAllocation {
  planId: string;
  name: string;
  kind: PlanKind;
  scope: PlanScope;
  ownerName?: string;
  priority: number;
  /** Сколько нужно откладывать в месяц, чтобы успеть. */
  requiredMonthly: number;
  /** Сколько реально помещается при текущей ёмкости (по очереди приоритетов). */
  allocatedMonthly: number;
  fits: boolean;
  remaining: number;
  savedAmount: number;
  targetAmount: number;
  dueDate: string | null;
  /** Если не помещается — к какой дате успеем при выделяемой сумме. */
  projectedDate: string | null;
  /** Срок уже прошёл или наступает в этом месяце, а сумма не собрана. */
  overdue: boolean;
  categoryId?: string;
  categoryName?: string;
  /** Факт трат по связанной категории: среднее в месяц за историю. */
  categoryAverageMonthly?: number;
}

export interface CategoryForecast {
  categoryId: string;
  categoryName: string;
  averageMonthly: number;
  lastMonth: number;
  trendPercent: number | null; // последние 3 мес. к предыдущим 3
  forecastNextMonth: number;
  yearlyEstimate: number;
  hasPlan: boolean;
}

export interface Suggestion {
  kind: 'OVERCOMMITTED' | 'SLIPS' | 'OVERDUE' | 'CATEGORY_NO_PLAN' | 'CATEGORY_ABOVE_PLAN' | 'FREE_MONEY' | 'LOW_HISTORY';
  text: string;
  planId?: string;
  categoryId?: string;
  amount?: number;
}

export interface TimelineEvent {
  month: string;
  planId: string;
  name: string;
  amount: number;
  projectedSaved: number;
  covered: boolean;
}

export interface PlanningResult {
  today: string;
  historyMonths: number;
  sufficientHistory: boolean;
  /** Медиана свободных денег в месяц (или ручное значение what-if). */
  monthlyCapacity: number;
  capacitySource: 'MEDIAN' | 'OVERRIDE';
  medianIncome: number;
  medianExpense: number;
  totalRequired: number;
  totalAllocated: number;
  freeAfterPlans: number;
  fits: boolean;
  plans: PlanAllocation[];
  categories: CategoryForecast[];
  timeline: TimelineEvent[];
  suggestions: Suggestion[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const DAYS_PER_MONTH = 30.44;

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}

export function addMonthsIso(date: string, months: number): string {
  const d = new Date(date.slice(0, 10) + 'T00:00:00Z');
  const whole = Math.floor(months);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + whole);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  const frac = months - whole;
  if (frac > 0) d.setUTCDate(d.getUTCDate() + Math.round(frac * DAYS_PER_MONTH));
  return d.toISOString().slice(0, 10);
}

/** Месяцев (дробно) от today до date; минимум 0. */
export function monthsUntil(today: string, date: string): number {
  return Math.max(0, daysBetween(today, date.slice(0, 10)) / DAYS_PER_MONTH);
}

/** Сколько нужно откладывать в месяц под план и к какому сроку. */
export function requiredFor(plan: PlanInput, today: string): { requiredMonthly: number; remaining: number; dueDate: string | null; overdue: boolean } {
  if (plan.kind === 'OPEN') {
    const monthly = Math.max(0, plan.plannedMonthly ?? 0);
    return { requiredMonthly: r2(monthly), remaining: 0, dueDate: null, overdue: false };
  }
  if (plan.kind === 'RECURRING') {
    const every = Math.max(1, plan.recurrenceMonths ?? 12);
    const amount = Math.max(0, plan.targetAmount);
    let next = plan.nextDate?.slice(0, 10) ?? addMonthsIso(today, every);
    // Если ближайшая дата уже прошла — следующий цикл (трата считается состоявшейся).
    let guard = 0;
    while (next < today && guard++ < 240) next = addMonthsIso(next, every);
    const remaining = Math.max(0, amount - plan.savedAmount);
    const left = monthsUntil(today, next);
    // Под ближайшую трату — остаток/месяцы до неё; в устоявшемся режиме — amount/every.
    // Берём максимум: если начали копить поздно, в этом цикле нужно больше.
    const steady = amount / every;
    const catchUp = left >= 1 ? remaining / left : remaining;
    const monthly = plan.plannedMonthly && plan.plannedMonthly > 0 ? plan.plannedMonthly : Math.max(steady, catchUp);
    return { requiredMonthly: r2(monthly), remaining: r2(remaining), dueDate: next, overdue: left < 1 && remaining > 0 };
  }
  // TARGET
  const remaining = Math.max(0, plan.targetAmount - plan.savedAmount);
  if (!plan.deadline) {
    const monthly = Math.max(0, plan.plannedMonthly ?? 0);
    return { requiredMonthly: r2(remaining > 0 ? monthly : 0), remaining: r2(remaining), dueDate: null, overdue: false };
  }
  const left = monthsUntil(today, plan.deadline);
  const overdue = left < 1 && remaining > 0;
  const monthly = remaining <= 0 ? 0 : plan.plannedMonthly && plan.plannedMonthly > 0 ? plan.plannedMonthly : left >= 1 ? remaining / left : remaining;
  return { requiredMonthly: r2(monthly), remaining: r2(remaining), dueDate: plan.deadline.slice(0, 10), overdue };
}

function sortPlans(plans: PlanInput[], today: string): PlanInput[] {
  return plans.slice().sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const da = requiredFor(a, today).dueDate ?? '9999-12-31';
    const db = requiredFor(b, today).dueDate ?? '9999-12-31';
    return da < db ? -1 : da > db ? 1 : a.name.localeCompare(b.name);
  });
}

export function buildCategoryForecasts(
  monthlyByCategory: Record<string, { name: string; months: Record<string, number> }>,
  months: string[], // полные месяцы истории по возрастанию
  plannedCategoryIds: Set<string>,
): CategoryForecast[] {
  const res: CategoryForecast[] = [];
  for (const [categoryId, info] of Object.entries(monthlyByCategory)) {
    const series = months.map((m) => info.months[m] ?? 0);
    if (!series.some((v) => v > 0)) continue;
    const avg = series.reduce((s, v) => s + v, 0) / Math.max(1, series.length);
    const last3 = series.slice(-3);
    const prev3 = series.slice(-6, -3);
    const avgLast3 = last3.reduce((s, v) => s + v, 0) / Math.max(1, last3.length);
    const avgPrev3 = prev3.length ? prev3.reduce((s, v) => s + v, 0) / prev3.length : 0;
    const trend = avgPrev3 > 0 ? Math.round(((avgLast3 - avgPrev3) / avgPrev3) * 1000) / 10 : null;
    // Прогноз: взвешенно — 60% последние 3 месяца, 40% вся история (сглаживает разовые всплески).
    const forecast = 0.6 * avgLast3 + 0.4 * avg;
    res.push({
      categoryId,
      categoryName: info.name,
      averageMonthly: r2(avg),
      lastMonth: r2(series[series.length - 1] ?? 0),
      trendPercent: trend,
      forecastNextMonth: r2(forecast),
      yearlyEstimate: r2(forecast * 12),
      hasPlan: plannedCategoryIds.has(categoryId),
    });
  }
  return res.sort((a, b) => b.averageMonthly - a.averageMonthly);
}

export function computePlan(input: {
  today: string;
  history: MonthFlow[]; // полные месяцы, по возрастанию
  plans: PlanInput[];
  categories?: CategoryForecast[];
  capacityOverride?: number | null;
  /** Категории, по которым подсказывать резерв, если плана нет (врачи, авто, подарки…). */
  watchCategoryIds?: string[];
  timelineMonths?: number;
}): PlanningResult {
  const { today } = input;
  const history = input.history.filter((h) => h.income > 0 || h.expense > 0);
  const nets = history.map((h) => h.income - h.expense);
  const medianNet = median(nets);
  const sufficientHistory = history.length >= 3;
  const override = input.capacityOverride !== undefined && input.capacityOverride !== null && Number.isFinite(input.capacityOverride);
  const capacity = Math.max(0, override ? Number(input.capacityOverride) : medianNet);

  const categories = input.categories ?? [];
  const catAvg = new Map(categories.map((c) => [c.categoryId, c.averageMonthly]));

  let left = capacity;
  const plans: PlanAllocation[] = [];
  for (const p of sortPlans(input.plans, today)) {
    const req = requiredFor(p, today);
    const allocated = Math.min(req.requiredMonthly, left);
    left = r2(left - allocated);
    const fits = allocated + 0.005 >= req.requiredMonthly;
    let projectedDate: string | null = req.dueDate;
    if (!fits && p.kind !== 'OPEN') {
      projectedDate = allocated > 0 ? addMonthsIso(today, Math.ceil((req.remaining / allocated) * 10) / 10) : null;
    }
    plans.push({
      planId: p.id,
      name: p.name,
      kind: p.kind,
      scope: p.scope,
      ownerName: p.ownerName,
      priority: p.priority,
      requiredMonthly: req.requiredMonthly,
      allocatedMonthly: r2(allocated),
      fits,
      remaining: req.remaining,
      savedAmount: r2(p.savedAmount),
      targetAmount: r2(p.targetAmount),
      dueDate: req.dueDate,
      projectedDate,
      overdue: req.overdue,
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      categoryAverageMonthly: p.categoryId ? catAvg.get(p.categoryId) : undefined,
    });
  }

  const totalRequired = r2(plans.reduce((s, p) => s + p.requiredMonthly, 0));
  const totalAllocated = r2(plans.reduce((s, p) => s + p.allocatedMonthly, 0));
  const freeAfterPlans = r2(capacity - totalAllocated);

  // ---- Таймлайн ближайших трат (TARGET-сроки и циклы RECURRING) ----
  const horizon = input.timelineMonths ?? 12;
  const horizonEnd = addMonthsIso(today, horizon);
  const timeline: TimelineEvent[] = [];
  for (const p of plans) {
    const src = input.plans.find((x) => x.id === p.planId)!;
    if (p.kind === 'TARGET' && p.dueDate && p.dueDate <= horizonEnd) {
      const projected = Math.min(p.targetAmount, p.savedAmount + p.allocatedMonthly * monthsUntil(today, p.dueDate));
      timeline.push({ month: p.dueDate.slice(0, 7), planId: p.planId, name: p.name, amount: p.targetAmount, projectedSaved: r2(projected), covered: projected + 0.5 >= p.targetAmount });
    }
    if (p.kind === 'RECURRING' && p.dueDate) {
      const every = Math.max(1, src.recurrenceMonths ?? 12);
      let date = p.dueDate;
      let saved = p.savedAmount;
      let cursor = today;
      let guard = 0;
      while (date <= horizonEnd && guard++ < 60) {
        saved += p.allocatedMonthly * monthsUntil(cursor, date);
        const covered = saved + 0.5 >= p.targetAmount;
        timeline.push({ month: date.slice(0, 7), planId: p.planId, name: p.name, amount: p.targetAmount, projectedSaved: r2(Math.min(saved, p.targetAmount)), covered });
        saved = Math.max(0, saved - p.targetAmount);
        cursor = date;
        date = addMonthsIso(date, every);
      }
    }
  }
  timeline.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  // ---- Подсказки (текст формирует код; ИИ может только пересказать) ----
  const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
  const d = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '—');
  const suggestions: Suggestion[] = [];
  if (!sufficientHistory && !override) {
    suggestions.push({ kind: 'LOW_HISTORY', text: `Истории всего ${history.length} мес. — оценка свободных денег неточная. Нужно минимум 3 полных месяца операций; можно задать сумму вручную.` });
  }
  if (totalRequired > capacity + 0.5) {
    suggestions.push({
      kind: 'OVERCOMMITTED',
      amount: r2(totalRequired - capacity),
      text: `Планам нужно ${fmt(totalRequired)} в месяц, а свободно около ${fmt(capacity)} — не хватает ${fmt(totalRequired - capacity)}. Самые поздние по приоритету планы сдвигаются.`,
    });
  }
  for (const p of plans) {
    if (p.overdue) {
      suggestions.push({ kind: 'OVERDUE', planId: p.planId, amount: p.remaining, text: `«${p.name}»: срок ${d(p.dueDate)} уже наступил, не собрано ${fmt(p.remaining)}.` });
    } else if (!p.fits && p.kind !== 'OPEN') {
      suggestions.push({
        kind: 'SLIPS',
        planId: p.planId,
        text: p.projectedDate
          ? `«${p.name}» к ${d(p.dueDate)} не успевает: нужно ${fmt(p.requiredMonthly)}/мес, помещается ${fmt(p.allocatedMonthly)}. При таком темпе — к ${d(p.projectedDate)}.`
          : `«${p.name}»: после планов с более высоким приоритетом денег не остаётся. Повысьте приоритет или сдвиньте срок.`,
      });
    } else if (!p.fits && p.kind === 'OPEN') {
      suggestions.push({ kind: 'SLIPS', planId: p.planId, text: `Резерв «${p.name}» (${fmt(p.requiredMonthly)}/мес) помещается только на ${fmt(p.allocatedMonthly)}.` });
    }
    if (p.categoryId && p.categoryAverageMonthly !== undefined && p.kind === 'OPEN' && p.categoryAverageMonthly > p.requiredMonthly * 1.15) {
      suggestions.push({
        kind: 'CATEGORY_ABOVE_PLAN',
        planId: p.planId,
        categoryId: p.categoryId,
        amount: p.categoryAverageMonthly,
        text: `На «${p.categoryName ?? p.name}» в среднем уходит ${fmt(p.categoryAverageMonthly)}/мес — больше резерва ${fmt(p.requiredMonthly)}. Стоит увеличить резерв.`,
      });
    }
  }
  const watch = new Set(input.watchCategoryIds ?? []);
  for (const c of categories) {
    if (c.hasPlan || !watch.has(c.categoryId) || c.averageMonthly < 500) continue;
    suggestions.push({
      kind: 'CATEGORY_NO_PLAN',
      categoryId: c.categoryId,
      amount: c.forecastNextMonth,
      text: `На «${c.categoryName}» уходит в среднем ${fmt(c.averageMonthly)}/мес (≈ ${fmt(c.yearlyEstimate)} в год), а резерва нет. Предлагаю откладывать ${fmt(c.forecastNextMonth)}/мес.`,
    });
  }
  if (freeAfterPlans > 1000 && plans.length > 0 && totalRequired <= capacity) {
    suggestions.push({ kind: 'FREE_MONEY', amount: freeAfterPlans, text: `После всех планов остаётся около ${fmt(freeAfterPlans)}/мес — можно ускорить цели или пополнить подушку.` });
  }

  return {
    today,
    historyMonths: history.length,
    sufficientHistory,
    monthlyCapacity: r2(capacity),
    capacitySource: override ? 'OVERRIDE' : 'MEDIAN',
    medianIncome: r2(median(history.map((h) => h.income))),
    medianExpense: r2(median(history.map((h) => h.expense))),
    totalRequired,
    totalAllocated,
    freeAfterPlans,
    fits: totalRequired <= capacity + 0.5,
    plans,
    categories,
    timeline,
    suggestions,
  };
}

/** Полные месяцы перед текущим: ['2026-05', … '2026-10'] для today=2026-11-07, n=6. */
export function lastFullMonths(today: string, n: number): string[] {
  const [y, m] = today.split('-').map(Number);
  const res: string[] = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    res.push(d.toISOString().slice(0, 7));
  }
  return res;
}

/** Слова, по которым категория считается «стоит планировать резерв» (врачи и т.п.). */
export const WATCH_CATEGORY_HINTS = /мед|врач|здоров|аптек|лекар|стомат|клиник|анализ|страхов|авто|машин|подар|ремонт|образов|обучен|дет|животн|ветеринар/i;
