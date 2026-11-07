/**
 * Поиск подписок и регулярных платежей (Итерация 4) — по образцу Maybe
 * (recurring transactions) и Firefly III (bills). Чистая логика без Prisma.
 *
 * 1) detectRecurring — находит в истории расходов группы операций с одним и
 *    тем же получателем, похожей суммой и регулярным интервалом. Это только
 *    ПОДСКАЗКИ: в «Обязательные платежи» (financial_need) кандидат попадает
 *    лишь по кнопке пользователя.
 * 2) computeNeedsStatus — для каждого обязательного платежа на выбранный
 *    месяц: оплачен (найдена операция), ожидается, просрочен.
 */

export type RecurringPeriod = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface RecurringTx {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number; // расход — отрицательный
  description?: string;
  counterparty?: string;
  categoryId?: string;
}

export interface RecurringCandidate {
  key: string;
  label: string;
  period: RecurringPeriod;
  averageAmount: number;
  lastAmount: number;
  occurrences: number;
  firstDate: string;
  lastDate: string;
  nextExpectedDate: string;
  categoryId?: string;
  transactionIds: string[];
  /** Примерно ежемесячная нагрузка — чтобы сравнивать недельные и годовые подписки. */
  monthlyEquivalent: number;
  /** Уже заведён обязательный платёж с подходящим шаблоном поиска. */
  alreadyTracked: boolean;
}

const PERIODS: { period: RecurringPeriod; days: number; tolerance: number; minOccurrences: number }[] = [
  { period: 'WEEKLY', days: 7, tolerance: 2, minOccurrences: 4 },
  { period: 'MONTHLY', days: 30.4, tolerance: 6, minOccurrences: 3 },
  { period: 'QUARTERLY', days: 91, tolerance: 12, minOccurrences: 3 },
  { period: 'YEARLY', days: 365, tolerance: 20, minOccurrences: 2 },
];

const STOP_WORDS = new Set(['оплата', 'покупка', 'списание', 'платеж', 'платёж', 'retail', 'rus', 'moscow', 'москва', 'г', 'по', 'карте', 'в', 'на']);

const MONTHLY_FACTOR: Record<RecurringPeriod, number> = { WEEKLY: 52 / 12, MONTHLY: 1, QUARTERLY: 1 / 3, YEARLY: 1 / 12 };

/**
 * Ключ группировки: контрагент или описание без цифр/служебных слов —
 * «Оплата YANDEX*PLUS 5814 ...» и «YANDEX*PLUS 4411» должны попасть в одну группу.
 */
export function recurringKey(tx: Pick<RecurringTx, 'description' | 'counterparty'>): string {
  const base = (tx.counterparty && tx.counterparty.trim()) || tx.description || '';
  return base
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\d+([.,]\d+)?/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    // \b в JS не работает с кириллицей — стоп-слова убираем по словам.
    .filter((w) => w && !STOP_WORDS.has(w))
    .slice(0, 3)
    .join(' ');
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function addDays(date: string, days: number): string {
  const d = new Date(Date.parse(date + 'T00:00:00Z') + Math.round(days) * 86400000);
  return d.toISOString().slice(0, 10);
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function detectRecurring(
  transactions: RecurringTx[],
  opts: { today: string; trackedPatterns?: string[]; amountTolerance?: number } ,
): RecurringCandidate[] {
  const amountTolerance = opts.amountTolerance ?? 0.2;
  const tracked = (opts.trackedPatterns ?? []).map((p) => p.toLowerCase().replace(/ё/g, 'е').trim()).filter(Boolean);

  const groups = new Map<string, RecurringTx[]>();
  for (const tx of transactions) {
    if (!(tx.amount < 0) || !tx.date) continue;
    const key = recurringKey(tx);
    if (key.length < 3) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  const result: RecurringCandidate[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = list.slice().sort((a, b) => (a.date < b.date ? -1 : 1));

    // Сумма должна быть стабильной: оставляем операции в пределах ±20% от медианы
    // (одна разовая крупная покупка в том же магазине не ломает подписку).
    const med = median(sorted.map((t) => Math.abs(t.amount)));
    const stable = sorted.filter((t) => Math.abs(Math.abs(t.amount) - med) <= med * amountTolerance);
    if (stable.length < 2) continue;

    // Несколько списаний в один день (докупки) — схлопываем до одного.
    const byDay: RecurringTx[] = [];
    for (const t of stable) if (!byDay.length || byDay[byDay.length - 1].date !== t.date) byDay.push(t);

    const intervals: number[] = [];
    for (let i = 1; i < byDay.length; i++) intervals.push(daysBetween(byDay[i - 1].date, byDay[i].date));
    if (intervals.length === 0) continue;
    const medInterval = median(intervals);

    const match = PERIODS.find(
      (p) =>
        Math.abs(medInterval - p.days) <= p.tolerance &&
        byDay.length >= p.minOccurrences &&
        // большинство интервалов регулярны, а не одна случайная пара
        intervals.filter((iv) => Math.abs(iv - p.days) <= p.tolerance).length >= Math.ceil(intervals.length * 0.6),
    );
    if (!match) continue;

    const last = byDay[byDay.length - 1];
    // Давно не было списаний (пропущено больше двух периодов) — подписка, скорее всего, отменена.
    if (daysBetween(last.date, opts.today) > match.days * 2 + match.tolerance) continue;

    const avg = byDay.reduce((s, t) => s + Math.abs(t.amount), 0) / byDay.length;
    const label = (last.counterparty && last.counterparty.trim()) || last.description || key;
    const categoryCounts = new Map<string, number>();
    for (const t of byDay) if (t.categoryId) categoryCounts.set(t.categoryId, (categoryCounts.get(t.categoryId) ?? 0) + 1);
    const categoryId = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    result.push({
      key,
      label,
      period: match.period,
      averageAmount: round2(avg),
      lastAmount: round2(Math.abs(last.amount)),
      occurrences: byDay.length,
      firstDate: byDay[0].date,
      lastDate: last.date,
      nextExpectedDate: addDays(last.date, match.days),
      categoryId,
      transactionIds: byDay.map((t) => t.id),
      monthlyEquivalent: round2(avg * MONTHLY_FACTOR[match.period]),
      alreadyTracked: tracked.some((p) => key.includes(p) || p.includes(key) || label.toLowerCase().includes(p)),
    });
  }

  return result.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
}

// ---------- Статус обязательных платежей на месяц ----------

export interface NeedInput {
  id: string;
  name: string;
  amount: number;
  currency?: string;
  categoryId?: string;
  /** Текст, по которому ищем операцию оплаты в описании/контрагенте. */
  matchPattern?: string;
  /** День месяца, до которого нужно оплатить (1–31). */
  dueDay?: number;
  nextDueDate?: string;
  priority?: string;
}

export type NeedStatus = 'PAID' | 'DUE' | 'OVERDUE';

export interface NeedMonthStatus {
  needId: string;
  name: string;
  plannedAmount: number;
  paidAmount: number;
  status: NeedStatus;
  dueDate: string | null;
  matchedTransactionIds: string[];
  priority?: string;
}

function lastDayOfMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * month — 'YYYY-MM'. Операция «оплачивает» платёж, если это расход в этом
 * месяце и: (а) описание/контрагент содержит matchPattern, либо (б) шаблона
 * нет, но совпала категория и сумма в пределах ±25%. Одна операция
 * засчитывается только одному платежу.
 */
export function computeNeedsStatus(needs: NeedInput[], transactions: RecurringTx[], month: string, today: string): NeedMonthStatus[] {
  const inMonth = transactions.filter((t) => t.amount < 0 && t.date?.startsWith(month));
  const used = new Set<string>();
  const lastDay = lastDayOfMonth(month);

  return needs.map((need) => {
    const pattern = need.matchPattern?.toLowerCase().replace(/ё/g, 'е').trim();
    const matched = inMonth.filter((t) => {
      if (used.has(t.id)) return false;
      if (pattern) {
        const hay = `${t.description ?? ''} ${t.counterparty ?? ''}`.toLowerCase().replace(/ё/g, 'е');
        return hay.includes(pattern);
      }
      if (need.categoryId && t.categoryId === need.categoryId && need.amount > 0) {
        return Math.abs(Math.abs(t.amount) - need.amount) <= need.amount * 0.25;
      }
      return false;
    });
    // Без шаблона берём одну лучшую операцию (ближайшую по сумме), с шаблоном — все.
    const chosen = pattern
      ? matched
      : matched.sort((a, b) => Math.abs(Math.abs(a.amount) - need.amount) - Math.abs(Math.abs(b.amount) - need.amount)).slice(0, 1);
    chosen.forEach((t) => used.add(t.id));
    const paidAmount = round2(chosen.reduce((s, t) => s + Math.abs(t.amount), 0));

    let dueDate: string | null = null;
    if (need.dueDay && need.dueDay > 0) {
      dueDate = `${month}-${String(Math.min(need.dueDay, lastDay)).padStart(2, '0')}`;
    } else if (need.nextDueDate?.startsWith(month)) {
      dueDate = need.nextDueDate.slice(0, 10);
    }

    let status: NeedStatus;
    if (chosen.length > 0 && paidAmount >= need.amount * 0.9) status = 'PAID';
    else if (chosen.length > 0 && need.amount <= 0) status = 'PAID';
    else {
      const deadline = dueDate ?? `${month}-${String(lastDay).padStart(2, '0')}`;
      status = today > deadline ? 'OVERDUE' : 'DUE';
    }

    return {
      needId: need.id,
      name: need.name,
      plannedAmount: round2(need.amount),
      paidAmount,
      status,
      dueDate,
      matchedTransactionIds: chosen.map((t) => t.id),
      priority: need.priority,
    };
  });
}
