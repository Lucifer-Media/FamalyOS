/**
 * ИИ-отчётность по финансам (Итерация 4). Чистая логика без Prisma.
 *
 * Принцип проекта: ВСЕ финансовые расчёты — в коде, языковая модель только
 * пишет текст поверх уже посчитанных фактов. Поэтому:
 *   1) buildReportFacts — детерминированно считает все цифры отчёта;
 *   2) buildReportPrompt / buildQuestionPrompt — отдают модели компактный
 *      JSON фактов с запретом придумывать числа;
 *   3) findUnverifiedNumbers — после ответа проверяет, что каждое крупное
 *      число в тексте модели есть среди фактов (с допуском на округление);
 *      если нет — отчёт помечается предупреждением, а не молча доверяется;
 *   4) buildFallbackNarrative — текст без ИИ, если модель недоступна
 *      (отчёт всё равно формируется).
 */

export interface FactTx {
  id: string;
  date: string;
  amount: number;
  description?: string;
  counterparty?: string;
  categoryId?: string;
  accountId?: string;
  transactionType?: string;
  scope?: string;
}

export interface CategoryFact {
  category: string;
  expense: number;
  previousExpense: number;
  averageExpense: number; // среднее за предыдущие N периодов такой же длины
  changePercent: number | null;
  share: number; // доля в расходах периода, %
}

export interface ReportFacts {
  periodStart: string;
  periodEnd: string;
  currency: string;
  income: number;
  expense: number;
  net: number;
  savingsRatePercent: number | null;
  previous: { income: number; expense: number; net: number };
  expenseChangePercent: number | null;
  transactionCount: number;
  uncategorizedCount: number;
  uncategorizedExpense: number;
  familyExpense: number;
  personalExpense: number;
  categories: CategoryFact[];
  anomalies: { category: string; expense: number; averageExpense: number; overPercent: number }[];
  topMerchants: { name: string; expense: number; count: number }[];
  largestExpenses: { date: string; description: string; amount: number; category: string }[];
  budgets: { name: string; planned: number; spent: number; percentUsed: number | null }[];
  needs: { name: string; status: string; planned: number; paid: number }[];
  goals: { name: string; saved: number; target: number; percent: number; estimatedDate: string | null }[];
  netWorth?: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);

function isCountable(t: FactTx): boolean {
  // Переводы между своими счетами — не доход и не расход семьи.
  return t.transactionType !== 'TRANSFER';
}

export function shiftPeriod(start: string, end: string, periodsBack: number): { start: string; end: string } {
  const s = Date.parse(start + 'T00:00:00Z');
  const e = Date.parse(end + 'T00:00:00Z');
  const len = Math.round((e - s) / 86400000) + 1;
  // Если период — ровно календарный месяц, сдвигаем по календарю (длины месяцев разные).
  const sd = new Date(s);
  const ed = new Date(e);
  const isMonth = sd.getUTCDate() === 1 && new Date(Date.UTC(ed.getUTCFullYear(), ed.getUTCMonth() + 1, 0)).getUTCDate() === ed.getUTCDate() && sd.getUTCMonth() === ed.getUTCMonth();
  if (isMonth) {
    const ps = new Date(Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth() - periodsBack, 1));
    const pe = new Date(Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth() - periodsBack + 1, 0));
    return { start: ps.toISOString().slice(0, 10), end: pe.toISOString().slice(0, 10) };
  }
  return {
    start: new Date(s - len * periodsBack * 86400000).toISOString().slice(0, 10),
    end: new Date(e - len * periodsBack * 86400000).toISOString().slice(0, 10),
  };
}

function inPeriod(t: FactTx, start: string, end: string) {
  return t.date >= start && t.date <= end;
}

function totals(txs: FactTx[]) {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (!isCountable(t)) continue;
    if (t.amount >= 0) income += t.amount;
    else expense += -t.amount;
  }
  return { income: round2(income), expense: round2(expense), net: round2(income - expense) };
}

function byCategory(txs: FactTx[], categoryName: (id?: string) => string) {
  const map = new Map<string, number>();
  for (const t of txs) {
    if (!isCountable(t) || t.amount >= 0) continue;
    const name = categoryName(t.categoryId);
    map.set(name, (map.get(name) ?? 0) + -t.amount);
  }
  return map;
}

export function buildReportFacts(input: {
  periodStart: string;
  periodEnd: string;
  currency: string;
  transactions: FactTx[];
  categoryNames: Record<string, string>;
  budgets?: ReportFacts['budgets'];
  needs?: ReportFacts['needs'];
  goals?: ReportFacts['goals'];
  netWorth?: number | null;
  averageWindow?: number;
}): ReportFacts {
  const { periodStart, periodEnd } = input;
  const window = input.averageWindow ?? 3;
  const categoryName = (id?: string) => (id && input.categoryNames[id]) || 'Без категории';

  const current = input.transactions.filter((t) => inPeriod(t, periodStart, periodEnd));
  const prevRange = shiftPeriod(periodStart, periodEnd, 1);
  const previous = input.transactions.filter((t) => inPeriod(t, prevRange.start, prevRange.end));

  const cur = totals(current);
  const prev = totals(previous);

  const curCats = byCategory(current, categoryName);
  const prevCats = byCategory(previous, categoryName);
  const historyCats: Map<string, number>[] = [];
  for (let i = 1; i <= window; i++) {
    const r = shiftPeriod(periodStart, periodEnd, i);
    historyCats.push(byCategory(input.transactions.filter((t) => inPeriod(t, r.start, r.end)), categoryName));
  }

  const categories: CategoryFact[] = [...curCats.entries()]
    .map(([category, expense]) => {
      const previousExpense = prevCats.get(category) ?? 0;
      const averageExpense = historyCats.reduce((s, m) => s + (m.get(category) ?? 0), 0) / window;
      return {
        category,
        expense: round2(expense),
        previousExpense: round2(previousExpense),
        averageExpense: round2(averageExpense),
        changePercent: pct(expense, previousExpense),
        share: cur.expense > 0 ? Math.round((expense / cur.expense) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.expense - a.expense);

  // Аномалия — категория заметно выше своего среднего (>30% и минимум 1000 ₽ сверху,
  // чтобы рост «кофе с 200 до 400» не забивал отчёт).
  const anomalies = categories
    .filter((c) => c.averageExpense > 0 && c.expense > c.averageExpense * 1.3 && c.expense - c.averageExpense >= 1000)
    .map((c) => ({
      category: c.category,
      expense: c.expense,
      averageExpense: c.averageExpense,
      overPercent: Math.round(((c.expense - c.averageExpense) / c.averageExpense) * 1000) / 10,
    }))
    .slice(0, 5);

  const merchants = new Map<string, { expense: number; count: number }>();
  for (const t of current) {
    if (!isCountable(t) || t.amount >= 0) continue;
    const name = (t.counterparty || t.description || '—').trim().slice(0, 60);
    const m = merchants.get(name) ?? { expense: 0, count: 0 };
    m.expense += -t.amount;
    m.count += 1;
    merchants.set(name, m);
  }
  const topMerchants = [...merchants.entries()]
    .map(([name, m]) => ({ name, expense: round2(m.expense), count: m.count }))
    .sort((a, b) => b.expense - a.expense)
    .slice(0, 7);

  const largestExpenses = current
    .filter((t) => isCountable(t) && t.amount < 0)
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 5)
    .map((t) => ({ date: t.date, description: (t.description || t.counterparty || '—').slice(0, 80), amount: round2(-t.amount), category: categoryName(t.categoryId) }));

  const expenses = current.filter((t) => isCountable(t) && t.amount < 0);
  const uncategorized = expenses.filter((t) => !t.categoryId);

  return {
    periodStart,
    periodEnd,
    currency: input.currency,
    income: cur.income,
    expense: cur.expense,
    net: cur.net,
    savingsRatePercent: cur.income > 0 ? Math.round((cur.net / cur.income) * 1000) / 10 : null,
    previous: prev,
    expenseChangePercent: pct(cur.expense, prev.expense),
    transactionCount: current.length,
    uncategorizedCount: uncategorized.length,
    uncategorizedExpense: round2(uncategorized.reduce((s, t) => s - t.amount, 0)),
    familyExpense: round2(expenses.filter((t) => t.scope !== 'PERSONAL').reduce((s, t) => s - t.amount, 0)),
    personalExpense: round2(expenses.filter((t) => t.scope === 'PERSONAL').reduce((s, t) => s - t.amount, 0)),
    categories,
    anomalies,
    topMerchants,
    largestExpenses,
    budgets: input.budgets ?? [],
    needs: input.needs ?? [],
    goals: input.goals ?? [],
    netWorth: input.netWorth ?? null,
  };
}

/** Компактная версия фактов для промпта — у локальной модели на CPU маленькое окно контекста. */
export function compactFacts(f: ReportFacts) {
  return {
    период: `${f.periodStart} — ${f.periodEnd}`,
    валюта: f.currency,
    доходы: f.income,
    расходы: f.expense,
    итог_месяца: f.net,
    норма_сбережений_процент: f.savingsRatePercent,
    прошлый_период: f.previous,
    изменение_расходов_процент: f.expenseChangePercent,
    семейные_расходы: f.familyExpense,
    личные_расходы: f.personalExpense,
    без_категории: { операций: f.uncategorizedCount, сумма: f.uncategorizedExpense },
    категории: f.categories.slice(0, 12).map((c) => ({
      категория: c.category,
      расход: c.expense,
      прошлый_период: c.previousExpense,
      среднее: c.averageExpense,
      доля_процент: c.share,
    })),
    аномалии: f.anomalies,
    крупнейшие_получатели: f.topMerchants,
    крупнейшие_траты: f.largestExpenses,
    бюджеты: f.budgets,
    обязательные_платежи: f.needs,
    копилки: f.goals,
    чистый_капитал: f.netWorth,
  };
}

const COMMON_RULES = [
  'ПРАВИЛА (обязательно):',
  '1. Используй ТОЛЬКО числа из блока ДАННЫЕ. Не считай новые суммы сам, не складывай и не округляй по-своему — нужное уже посчитано.',
  '2. Если данных для вывода нет — так и скажи, не выдумывай.',
  '3. Пиши по-русски, для семьи из двух человек, без воды и без общих советов из интернета.',
  '4. Суммы пиши как в данных, с пробелами между разрядами и знаком ₽ (или валютой из данных).',
];

export function buildReportPrompt(facts: ReportFacts): string {
  return [
    'Ты — финансовый аналитик семейного бюджета Family OS. Напиши короткий отчёт по данным ниже.',
    '',
    ...COMMON_RULES,
    '',
    'СТРУКТУРА ОТВЕТА (Markdown):',
    '## Главное — 2–3 предложения: итог периода и норма сбережений.',
    '## Что изменилось — 3–5 пунктов: самые заметные изменения по категориям и аномалии.',
    '## На что обратить внимание — обязательные платежи без оплаты, бюджеты близко к лимиту, операции без категории.',
    '## Рекомендации — 2–4 конкретных шага именно по этим данным.',
    '',
    'ДАННЫЕ:',
    JSON.stringify(compactFacts(facts)),
  ].join('\n');
}

export function buildQuestionPrompt(question: string, facts: ReportFacts): string {
  return [
    'Ты — финансовый помощник семьи в Family OS. Ответь на вопрос, опираясь только на данные ниже.',
    '',
    ...COMMON_RULES,
    '5. Отвечай кратко: 3–8 предложений или короткий список.',
    '',
    'ДАННЫЕ:',
    JSON.stringify(compactFacts(facts)),
    '',
    `ВОПРОС: ${question.slice(0, 500)}`,
  ].join('\n');
}

/** Все числа, которые встречаются в фактах (рекурсивно) — эталон для проверки. */
export function collectFactNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(Math.abs(value));
  else if (Array.isArray(value)) value.forEach((v) => collectFactNumbers(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectFactNumbers(v, out));
  return out;
}

/**
 * Находит в тексте модели «крупные» числа (≥ 100, не даты/годы), которых нет
 * среди фактов с допуском 1% или 1 ₽ (модель может написать «≈ 45 тыс.» —
 * тысячи/миллионы раскрываются). Это не доказательство ошибки, а сигнал
 * пользователю перепроверить.
 */
export function findUnverifiedNumbers(text: string, facts: ReportFacts): string[] {
  const known = collectFactNumbers(facts);
  const unverified: string[] = [];
  // Пример совпадений: "45 300", "45300,50", "45,3 тыс", "1.2 млн"
  const re = /(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,](\d+))?\s*(тыс\.?|млн\.?)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0].trim();
    const intPart = m[1].replace(/[   ]/g, '');
    let num = Number(intPart + (m[2] ? '.' + m[2] : ''));
    const unit = (m[3] || '').toLowerCase();
    if (unit.startsWith('тыс')) num *= 1000;
    if (unit.startsWith('млн')) num *= 1_000_000;
    if (!Number.isFinite(num) || num < 100) continue;
    // Годы и даты (2026, 2026-10-01) не проверяем.
    if (!unit && !m[2] && num >= 1900 && num <= 2100) continue;
    const prevChar = text[m.index - 1];
    if (prevChar === '-' || prevChar === '.' || prevChar === '/') continue; // часть даты
    const tolerance = unit ? 0.05 : 0.01;
    const ok = known.some((k) => Math.abs(k - num) <= Math.max(1, k * tolerance));
    if (!ok && !unverified.includes(raw)) unverified.push(raw);
  }
  return unverified.slice(0, 10);
}

export function formatMoney(n: number, currency = 'RUB'): string {
  const sign = currency === 'RUB' ? '₽' : currency;
  return `${Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ')} ${sign}`;
}

/** Отчёт без ИИ — если ни одна модель не ответила. Те же факты, шаблонный текст. */
export function buildFallbackNarrative(f: ReportFacts): string {
  const m = (n: number) => formatMoney(n, f.currency);
  const lines: string[] = [];
  lines.push('## Главное');
  lines.push(
    `За период ${f.periodStart} — ${f.periodEnd} доходы ${m(f.income)}, расходы ${m(f.expense)}, итог ${m(f.net)}` +
      (f.savingsRatePercent !== null ? `, норма сбережений ${f.savingsRatePercent}%.` : '.'),
  );
  if (f.expenseChangePercent !== null) lines.push(`Расходы к прошлому периоду: ${f.expenseChangePercent > 0 ? '+' : ''}${f.expenseChangePercent}%.`);
  lines.push('', '## Крупнейшие категории');
  for (const c of f.categories.slice(0, 5)) lines.push(`- ${c.category}: ${m(c.expense)} (${c.share}%)`);
  if (f.anomalies.length) {
    lines.push('', '## Выше обычного');
    for (const a of f.anomalies) lines.push(`- ${a.category}: ${m(a.expense)} при среднем ${m(a.averageExpense)} (+${a.overPercent}%)`);
  }
  const attention: string[] = [];
  for (const n of f.needs.filter((x) => x.status !== 'PAID')) attention.push(`- ${n.name}: ${n.status === 'OVERDUE' ? 'просрочен' : 'ожидается'} (${m(n.planned)})`);
  for (const b of f.budgets.filter((x) => (x.percentUsed ?? 0) >= 80)) attention.push(`- Бюджет «${b.name}»: использовано ${b.percentUsed}%`);
  if (f.uncategorizedCount) attention.push(`- Без категории: ${f.uncategorizedCount} операций на ${m(f.uncategorizedExpense)}`);
  if (attention.length) lines.push('', '## На что обратить внимание', ...attention);
  lines.push('', '_ИИ был недоступен — отчёт составлен автоматически по шаблону._');
  return lines.join('\n');
}
