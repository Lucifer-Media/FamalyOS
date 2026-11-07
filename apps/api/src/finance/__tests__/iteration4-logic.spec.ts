import { applyRules, normalizeRule, validateRule, conditionMatches, suggestConditionFromTransaction, FinanceRule } from '../finance-rules';
import { detectRecurring, computeNeedsStatus, recurringKey } from '../recurring-detection';
import { computeGoalProgress } from '../goal-progress';
import { buildReportFacts, findUnverifiedNumbers, buildFallbackNarrative, shiftPeriod, FactTx } from '../finance-report-facts';
import { parseCategorizeResponse } from '../ai-categorize';

const rule = (over: Partial<FinanceRule>): FinanceRule => ({
  id: over.id ?? 'r1',
  name: over.name ?? 'Правило',
  isActive: true,
  priority: 100,
  matchMode: 'ALL',
  conditions: [],
  ...over,
});

describe('Правила автокатегоризации', () => {
  it('описание содержит — без учёта регистра и ё/е', () => {
    expect(conditionMatches({ description: 'ПЯТЁРОЧКА 1234 Москва' }, { field: 'description', op: 'contains', value: 'пятерочка' })).toBe(true);
  });

  it('сумма сравнивается по модулю (расходы отрицательные)', () => {
    expect(conditionMatches({ amount: -6000 }, { field: 'amount', op: 'gt', value: '5000' })).toBe(true);
    expect(conditionMatches({ amount: -4000 }, { field: 'amount', op: 'gt', value: '5000' })).toBe(false);
  });

  it('применяет категорию и scope, не перезаписывая заполненное (onlyEmpty)', () => {
    const r = rule({ conditions: [{ field: 'description', op: 'contains', value: 'вкусвилл' }], setCategoryId: 'cat-food', setScope: 'FAMILY' });
    const res = applyRules({ description: 'ВкусВилл', categoryId: undefined, scope: 'PERSONAL' }, [r]);
    expect(res.changes).toEqual({ categoryId: 'cat-food' });
    expect(res.matchedRuleNames).toEqual(['Правило']);
  });

  it('порядок по приоритету: первое правило занимает поле', () => {
    const a = rule({ id: 'a', name: 'A', priority: 1, conditions: [{ field: 'description', op: 'contains', value: 'яндекс' }], setCategoryId: 'taxi' });
    const b = rule({ id: 'b', name: 'B', priority: 2, conditions: [{ field: 'description', op: 'contains', value: 'яндекс' }], setCategoryId: 'subs' });
    expect(applyRules({ description: 'Яндекс Такси' }, [b, a]).changes.categoryId).toBe('taxi');
  });

  it('ANY-режим и неактивные правила', () => {
    const r = rule({ matchMode: 'ANY', conditions: [{ field: 'mcc', op: 'equals', value: '5411' }, { field: 'description', op: 'contains', value: 'zzz' }], setCategoryId: 'c' });
    expect(applyRules({ mcc: '5411' }, [r]).changes.categoryId).toBe('c');
    expect(applyRules({ mcc: '5411' }, [{ ...r, isActive: false }]).changes.categoryId).toBeUndefined();
  });

  it('тип операции «перевод» применяется даже если тип уже заполнен', () => {
    const r = rule({ conditions: [{ field: 'description', op: 'contains', value: 'на накопительный' }], setTransactionType: 'TRANSFER' });
    expect(applyRules({ description: 'Перевод на накопительный', transactionType: 'EXPENSE' }, [r]).changes.transactionType).toBe('TRANSFER');
  });

  it('битый regex не роняет применение, валидация его ловит', () => {
    expect(conditionMatches({ description: 'abc' }, { field: 'description', op: 'regex', value: '([' })).toBe(false);
    expect(validateRule({ conditions: [{ field: 'description', op: 'regex', value: '([' }], setCategoryId: 'x' }).length).toBeGreaterThan(0);
    expect(validateRule({ conditions: [], setCategoryId: undefined })).toHaveLength(2);
  });

  it('normalizeRule отбрасывает мусор в conditions', () => {
    const r = normalizeRule('id', { name: 'X', conditions: [null, { field: 'description', op: 'contains', value: '' }, { field: 'description', op: 'contains', value: 'ok' }] });
    expect(r.conditions).toHaveLength(1);
    expect(r.isActive).toBe(true);
  });

  it('подсказка условия из операции убирает цифры', () => {
    expect(suggestConditionFromTransaction({ description: 'YANDEX*PLUS 5814 MOSCOW' })).toEqual({ field: 'description', op: 'contains', value: 'YANDEX PLUS' });
    expect(suggestConditionFromTransaction({ counterparty: 'Ростелеком' })).toEqual({ field: 'counterparty', op: 'contains', value: 'Ростелеком' });
  });
});

describe('Поиск регулярных платежей', () => {
  const monthly = (desc: string, amount: number, dates: string[]) => dates.map((d, i) => ({ id: `${desc}-${i}`, date: d, amount, description: desc }));

  it('находит ежемесячную подписку с плавающей датой и стабильной суммой', () => {
    const txs = monthly('YANDEX PLUS 1234', -399, ['2026-07-05', '2026-08-04', '2026-09-06', '2026-10-05']);
    const res = detectRecurring(txs, { today: '2026-11-01' });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ period: 'MONTHLY', occurrences: 4, averageAmount: 399, nextExpectedDate: '2026-11-04' });
  });

  it('разовая крупная покупка в том же магазине не ломает определение', () => {
    const txs = [...monthly('Ростелеком', -650, ['2026-07-10', '2026-08-10', '2026-09-10', '2026-10-10']), { id: 'x', date: '2026-08-20', amount: -12000, description: 'Ростелеком' }];
    expect(detectRecurring(txs, { today: '2026-11-01' })[0].occurrences).toBe(4);
  });

  it('не считает подпиской нерегулярные траты и давно прекращённые', () => {
    expect(detectRecurring(monthly('Кафе', -500, ['2026-07-01', '2026-07-03', '2026-08-29']), { today: '2026-09-01' })).toHaveLength(0);
    expect(detectRecurring(monthly('Netflix', -999, ['2026-01-01', '2026-02-01', '2026-03-01']), { today: '2026-11-01' })).toHaveLength(0);
  });

  it('помечает уже заведённые обязательные платежи', () => {
    const txs = monthly('Ростелеком', -650, ['2026-08-10', '2026-09-10', '2026-10-10']);
    expect(detectRecurring(txs, { today: '2026-11-01', trackedPatterns: ['ростелеком'] })[0].alreadyTracked).toBe(true);
  });

  it('ключ группировки игнорирует цифры и служебные слова', () => {
    expect(recurringKey({ description: 'Оплата YANDEX*PLUS 5814' })).toBe(recurringKey({ description: 'YANDEX*PLUS 4411' }));
  });

  it('статус обязательных платежей: оплачен / ожидается / просрочен', () => {
    const needs = [
      { id: 'n1', name: 'Интернет', amount: 650, matchPattern: 'ростелеком', dueDay: 15 },
      { id: 'n2', name: 'Аренда', amount: 50000, dueDay: 5 },
      { id: 'n3', name: 'Садик', amount: 8000, categoryId: 'kids', dueDay: 25 },
    ];
    const txs = [
      { id: 't1', date: '2026-11-03', amount: -650, description: 'РОСТЕЛЕКОМ' },
      { id: 't2', date: '2026-11-04', amount: -7900, description: 'Оплата', categoryId: 'kids' },
    ];
    const res = computeNeedsStatus(needs, txs, '2026-11', '2026-11-10');
    expect(res.map((r) => r.status)).toEqual(['PAID', 'OVERDUE', 'PAID']);
    expect(res[2].matchedTransactionIds).toEqual(['t2']);
  });
});

describe('Копилки', () => {
  it('считает прогресс, темп и прогноз даты', () => {
    const p = computeGoalProgress(
      { id: 'g', name: 'Отпуск', targetAmount: 300000, startAmount: 50000 },
      [
        { date: '2026-08-10', amount: 25000 },
        { date: '2026-09-10', amount: 25000 },
        { date: '2026-10-10', amount: 25000 },
      ],
      '2026-11-01',
    );
    expect(p.savedAmount).toBe(125000);
    expect(p.remaining).toBe(175000);
    expect(p.averageMonthlyContribution).toBeGreaterThan(20000);
    expect(p.estimatedDate! > '2027-03-01').toBe(true);
  });

  it('требуемый взнос под срок и отставание', () => {
    const p = computeGoalProgress({ id: 'g', name: 'Машина', targetAmount: 120000, deadline: '2027-05-01' }, [{ date: '2026-10-15', amount: 5000 }], '2026-11-01');
    expect(p.requiredMonthlyForDeadline).toBeGreaterThan(19000);
    expect(p.onTrack).toBe(false);
  });

  it('режим «баланс счёта» и выполненная цель', () => {
    const p = computeGoalProgress({ id: 'g', name: 'Подушка', targetAmount: 100000, trackingMode: 'ACCOUNT_BALANCE', accountBalance: 120000 }, [], '2026-11-01');
    expect(p).toMatchObject({ isCompleted: true, percent: 100, remaining: 0, onTrack: true });
  });
});

describe('Факты ИИ-отчёта', () => {
  const txs: FactTx[] = [
    { id: '1', date: '2026-10-05', amount: 200000, description: 'Зарплата' },
    { id: '2', date: '2026-10-06', amount: -30000, categoryId: 'food', description: 'Пятёрочка' },
    { id: '3', date: '2026-10-07', amount: -50000, transactionType: 'TRANSFER', description: 'Между своими счетами' },
    { id: '4', date: '2026-10-08', amount: -5000, description: 'Неизвестно' },
    { id: '5', date: '2026-09-06', amount: -15000, categoryId: 'food' },
    { id: '6', date: '2026-08-06', amount: -15000, categoryId: 'food' },
    { id: '7', date: '2026-07-06', amount: -15000, categoryId: 'food' },
  ];
  const facts = buildReportFacts({ periodStart: '2026-10-01', periodEnd: '2026-10-31', currency: 'RUB', transactions: txs, categoryNames: { food: 'Продукты' } });

  it('переводы не считаются расходом, всё считается кодом', () => {
    expect(facts).toMatchObject({ income: 200000, expense: 35000, net: 165000, savingsRatePercent: 82.5, uncategorizedCount: 1, uncategorizedExpense: 5000 });
    expect(facts.previous.expense).toBe(15000);
  });

  it('находит аномалию относительно среднего за 3 периода', () => {
    expect(facts.anomalies[0]).toMatchObject({ category: 'Продукты', expense: 30000, averageExpense: 15000, overPercent: 100 });
  });

  it('календарный сдвиг периода для месяцев разной длины', () => {
    expect(shiftPeriod('2026-03-01', '2026-03-31', 1)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('проверка чисел в тексте ИИ: известные проходят, выдуманные помечаются', () => {
    const text = 'Расходы 35 000 ₽, доход 200000 ₽ (2026 год). Продукты выросли до 30 тыс. А ещё 77 777 ₽ на что-то.';
    expect(findUnverifiedNumbers(text, facts)).toEqual(['77 777']);
  });

  it('шаблонный отчёт без ИИ содержит итоги', () => {
    const t = buildFallbackNarrative(facts);
    expect(t).toContain('## Главное');
    expect(t).toContain('Без категории: 1');
  });
});

describe('Числа в промпте — готовыми русскими строками', () => {
  it('РЕГРЕССИЯ: 378.45 уходит модели как «378,45», а «378,45» в ответе проверку проходит', () => {
    const { compactFacts, buildReportFacts, findUnverifiedNumbers } = require('../finance-report-facts');
    const f = buildReportFacts({ periodStart: '2026-11-01', periodEnd: '2026-11-30', currency: 'RUB', transactions: [], categoryNames: {}, accounts: [{ name: 'Семейный', bank: 'Альфа Банк', balance: 378.45, currency: 'RUB' }] });
    expect(JSON.stringify(compactFacts(f))).toContain('"баланс":"378,45"');
    expect(findUnverifiedNumbers('На счёте 378,45 ₽', f)).toEqual([]);
    expect(findUnverifiedNumbers('На счёте 378 450 ₽', f)).toEqual(['378 450']);
  });
});

describe('ИИ-категоризация: разбор ответа', () => {
  it('принимает только категории из справочника', () => {
    const txs = [{ id: 'a', amount: -100 }, { id: 'b', amount: -200 }, { id: 'c', amount: -300 }];
    const res = parseCategorizeResponse('```json\n{"1": "Продукты", "2": "Космос", "3": "транспорт"}\n```', txs, [
      { id: 'food', name: 'Продукты' },
      { id: 'tr', name: 'Транспорт' },
    ]);
    expect(res).toEqual([
      { transactionId: 'a', categoryId: 'food', categoryName: 'Продукты' },
      { transactionId: 'c', categoryId: 'tr', categoryName: 'Транспорт' },
    ]);
    expect(parseCategorizeResponse('не json', txs, [])).toEqual([]);
  });
});
