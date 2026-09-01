/**
 * Разбивка бюджета по периодам (год/месяц/неделя) — "Итерация 3", пункт 5
 * запроса: "возможность расписывать бюджеты по годам, месяцам, неделям".
 *
 * Хранится как обычный JSON-атрибут `periodAllocations` внутри Entity
 * (`budget`), без изменения схемы БД — в духе принципа проекта
 * "общая оболочка + специализированная структура в attributes".
 * Эта логика намеренно вынесена в файл без импортов Prisma, чтобы её
 * можно было тестировать юнит-тестами в изоляции (см. урок в хендовере —
 * тесты, тянущие entities.service.ts через Prisma-типы, иногда падают не
 * по вине кода).
 */

export type BudgetPeriodType = 'YEARLY' | 'MONTHLY' | 'WEEKLY';

export interface PeriodAllocation {
  /** Ключ периода: '2026' (YEARLY), '2026-09' (MONTHLY), '2026-W36' (WEEKLY) */
  period: string;
  plannedAmount: number;
  note?: string;
}

export interface PeriodSpendSummary {
  period: string;
  label: string;
  planned: number;
  spent: number;
  remaining: number;
  percentUsed: number | null;
}

const MONTH_LABELS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** ISO-8601 номер недели (пн-вс), формат 'YYYY-Www'. */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Приводит дату операции (YYYY-MM-DD) к ключу периода нужного типа. */
export function periodKeyForDate(date: string, periodType: BudgetPeriodType): string {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  if (periodType === 'YEARLY') return String(d.getUTCFullYear());
  if (periodType === 'MONTHLY') return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return isoWeekKey(d);
}

export function labelForPeriodKey(key: string, periodType: BudgetPeriodType): string {
  if (periodType === 'YEARLY') return key;
  if (periodType === 'MONTHLY') {
    const [y, m] = key.split('-');
    const idx = Number(m) - 1;
    return idx >= 0 && idx < 12 ? `${MONTH_LABELS[idx]} ${y}` : key;
  }
  // WEEKLY — '2026-W36' -> 'неделя 36, 2026'
  const [y, w] = key.split('-W');
  return w ? `нед. ${Number(w)}, ${y}` : key;
}

/**
 * Сопоставляет ручные распределения бюджета по периодам с фактическими
 * тратами (уже отобранными как относящиеся к этому бюджету — см.
 * FinanceAnalyticsService.matchBudgetTransactions). Только расходы
 * (отрицательные суммы) учитываются в "потрачено".
 */
export function computePeriodBreakdown(
  allocations: PeriodAllocation[],
  periodType: BudgetPeriodType,
  transactions: { date: string; amount: number }[],
): PeriodSpendSummary[] {
  const spentByPeriod = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.amount >= 0) continue;
    const key = periodKeyForDate(tx.date, periodType);
    if (!key) continue;
    spentByPeriod.set(key, (spentByPeriod.get(key) ?? 0) + Math.abs(tx.amount));
  }

  return allocations
    .filter((a) => a.period)
    .slice()
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))
    .map((a) => {
      const spent = Math.round((spentByPeriod.get(a.period) ?? 0) * 100) / 100;
      const planned = Number(a.plannedAmount) || 0;
      return {
        period: a.period,
        label: labelForPeriodKey(a.period, periodType),
        planned,
        spent,
        remaining: Math.round((planned - spent) * 100) / 100,
        percentUsed: planned > 0 ? Math.round((spent / planned) * 1000) / 10 : null,
      };
    });
}

/** Валидация структуры periodAllocations, приходящей из UI, перед сохранением в attributes. */
export function sanitizePeriodAllocations(input: unknown, periodType: BudgetPeriodType): PeriodAllocation[] {
  if (!Array.isArray(input)) return [];
  const validKey =
    periodType === 'YEARLY'
      ? /^\d{4}$/
      : periodType === 'MONTHLY'
        ? /^\d{4}-\d{2}$/
        : /^\d{4}-W\d{2}$/;
  return input
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      period: String((row as any).period ?? ''),
      plannedAmount: Number((row as any).plannedAmount) || 0,
      note: typeof (row as any).note === 'string' ? (row as any).note : undefined,
    }))
    .filter((row) => validKey.test(row.period));
}
