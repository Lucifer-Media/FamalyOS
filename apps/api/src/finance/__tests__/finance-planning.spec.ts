import { computePlan, requiredFor, buildCategoryForecasts, lastFullMonths, addMonthsIso, PlanInput } from '../finance-planning';

const today = '2026-11-07';
const history = [
  { month: '2026-05', income: 200000, expense: 160000 },
  { month: '2026-06', income: 200000, expense: 150000 },
  { month: '2026-07', income: 200000, expense: 250000 }, // отпуск — разовый провал, медиана его сгладит
  { month: '2026-08', income: 210000, expense: 160000 },
  { month: '2026-09', income: 200000, expense: 155000 },
  { month: '2026-10', income: 205000, expense: 160000 },
];

const plan = (p: Partial<PlanInput> & { id: string }): PlanInput => ({
  name: p.id,
  kind: 'TARGET',
  scope: 'FAMILY',
  priority: 3,
  targetAmount: 0,
  savedAmount: 0,
  ...p,
});

describe('Планирование — требуемые суммы', () => {
  it('TARGET: остаток / месяцы до срока', () => {
    const r = requiredFor(plan({ id: 'trip', targetAmount: 120000, savedAmount: 30000, deadline: '2027-05-07' }), today);
    expect(r.remaining).toBe(90000);
    expect(r.requiredMonthly).toBeGreaterThan(14500);
    expect(r.requiredMonthly).toBeLessThan(15500);
  });

  it('RECURRING: стоматолог 20 000 раз в 6 месяцев — устоявшийся резерв ≈ 3 333/мес, догоняющий — больше', () => {
    const steady = requiredFor(plan({ id: 'dent', kind: 'RECURRING', targetAmount: 20000, savedAmount: 20000, recurrenceMonths: 6, nextDate: '2027-05-01' }), today);
    expect(steady.requiredMonthly).toBeCloseTo(3333.33, 1);
    const late = requiredFor(plan({ id: 'dent', kind: 'RECURRING', targetAmount: 20000, savedAmount: 0, recurrenceMonths: 6, nextDate: '2027-01-07' }), today);
    expect(late.requiredMonthly).toBeGreaterThan(9000);
  });

  it('RECURRING: прошедшая дата переносится на следующий цикл', () => {
    const r = requiredFor(plan({ id: 'check', kind: 'RECURRING', targetAmount: 6000, savedAmount: 0, recurrenceMonths: 12, nextDate: '2026-03-01' }), today);
    expect(r.dueDate).toBe('2027-03-01');
  });

  it('OPEN: ежемесячный резерв как есть', () => {
    expect(requiredFor(plan({ id: 'med', kind: 'OPEN', plannedMonthly: 6000 }), today).requiredMonthly).toBe(6000);
  });
});

describe('Планирование — распределение и подсказки', () => {
  it('ёмкость = медиана свободных денег, разовый провал не ломает', () => {
    const res = computePlan({ today, history, plans: [] });
    expect(res.monthlyCapacity).toBe(45000);
    expect(res.sufficientHistory).toBe(true);
  });

  it('по приоритету: важное влезает, остальное сдвигается с новой датой', () => {
    const res = computePlan({
      today,
      history,
      plans: [
        plan({ id: 'med', name: 'Врачи', kind: 'OPEN', plannedMonthly: 6000, priority: 1 }),
        plan({ id: 'trip', name: 'Отпуск', targetAmount: 300000, deadline: '2027-05-07', priority: 2 }), // ≈ 50 000/мес
        plan({ id: 'tv', name: 'Телевизор', targetAmount: 60000, deadline: '2027-02-07', priority: 4 }),
      ],
    });
    const [med, trip, tv] = res.plans;
    expect(med).toMatchObject({ planId: 'med', fits: true, allocatedMonthly: 6000 });
    expect(trip.fits).toBe(false);
    expect(trip.allocatedMonthly).toBe(39000);
    expect(trip.projectedDate! > '2027-05-07').toBe(true);
    expect(tv).toMatchObject({ allocatedMonthly: 0, projectedDate: null });
    expect(res.fits).toBe(false);
    expect(res.suggestions.map((s) => s.kind)).toEqual(expect.arrayContaining(['OVERCOMMITTED', 'SLIPS']));
  });

  it('при равном приоритете раньше финансируется ближайший срок', () => {
    const res = computePlan({
      today,
      history,
      plans: [plan({ id: 'late', targetAmount: 10000, deadline: '2027-10-01' }), plan({ id: 'soon', targetAmount: 10000, deadline: '2027-01-01' })],
    });
    expect(res.plans.map((p) => p.planId)).toEqual(['soon', 'late']);
  });

  it('what-if: ручная ёмкость', () => {
    const res = computePlan({ today, history, plans: [plan({ id: 'x', targetAmount: 120000, deadline: '2027-05-07' })], capacityOverride: 100000 });
    expect(res).toMatchObject({ capacitySource: 'OVERRIDE', monthlyCapacity: 100000, fits: true });
    expect(res.suggestions.some((s) => s.kind === 'FREE_MONEY')).toBe(true);
  });

  it('мало истории — предупреждение', () => {
    const res = computePlan({ today, history: history.slice(-2), plans: [] });
    expect(res.sufficientHistory).toBe(false);
    expect(res.suggestions[0].kind).toBe('LOW_HISTORY');
  });

  it('врачи без резерва → подсказка завести резерв; резерв меньше факта → увеличить', () => {
    const months = lastFullMonths(today, 6);
    const cats = buildCategoryForecasts(
      { med: { name: 'Медицина', months: Object.fromEntries(months.map((m) => [m, 7000])) } },
      months,
      new Set(),
    );
    const noPlan = computePlan({ today, history, plans: [], categories: cats, watchCategoryIds: ['med'] });
    expect(noPlan.suggestions.find((s) => s.kind === 'CATEGORY_NO_PLAN')?.amount).toBe(7000);

    const withPlan = computePlan({
      today,
      history,
      plans: [plan({ id: 'm', kind: 'OPEN', plannedMonthly: 4000, categoryId: 'med', categoryName: 'Медицина' })],
      categories: buildCategoryForecasts({ med: { name: 'Медицина', months: Object.fromEntries(months.map((m) => [m, 7000])) } }, months, new Set(['med'])),
      watchCategoryIds: ['med'],
    });
    expect(withPlan.suggestions.some((s) => s.kind === 'CATEGORY_ABOVE_PLAN')).toBe(true);
    expect(withPlan.suggestions.some((s) => s.kind === 'CATEGORY_NO_PLAN')).toBe(false);
  });

  it('таймлайн: циклы резерва и покрытие трат', () => {
    const res = computePlan({
      today,
      history,
      plans: [plan({ id: 'dent', name: 'Стоматолог', kind: 'RECURRING', targetAmount: 20000, recurrenceMonths: 6, nextDate: '2027-05-07', savedAmount: 0 })],
    });
    const events = res.timeline.filter((e) => e.planId === 'dent');
    expect(events.map((e) => e.month)).toEqual(['2027-05', '2027-11']);
    expect(events[0].covered).toBe(true);
  });
});

describe('Планирование — вспомогательное', () => {
  it('прогноз категории учитывает тренд', () => {
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    const [c] = buildCategoryForecasts({ a: { name: 'Врачи', months: { '2026-05': 1000, '2026-06': 1000, '2026-07': 1000, '2026-08': 4000, '2026-09': 4000, '2026-10': 4000 } } }, months, new Set());
    expect(c.trendPercent).toBe(300);
    expect(c.forecastNextMonth).toBeGreaterThan(c.averageMonthly);
  });

  it('месяцы и даты', () => {
    expect(lastFullMonths('2026-01-15', 2)).toEqual(['2025-11', '2025-12']);
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
  });
});
