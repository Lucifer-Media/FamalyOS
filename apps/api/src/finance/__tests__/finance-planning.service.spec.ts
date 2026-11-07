import { FinancePlanningService } from '../finance-planning.service';

function make(txs: { id: string; attributes: Record<string, unknown> }[], goals: any[]) {
  const prisma: any = {
    familySpace: { findUnique: async () => ({ baseCurrency: 'RUB' }) },
    entity: {
      findMany: async ({ where }: any) => {
        if (where.entityType === 'financial_category') return [{ id: 'med', title: 'Медицина', attributes: { name: 'Медицина' } }];
        if (where.entityType === 'financial_goal') return goals;
        return [];
      },
    },
    person: { findMany: async () => [{ id: 'p-arina', fullName: 'Арина' }] },
  };
  const permissions = { getMembership: async () => ({}), assertCan: jest.fn(async () => undefined) };
  const automation = { loadActiveTransactions: async () => txs, getGoalsSummary: async () => goals.map((g) => ({ goalId: g.id, savedAmount: 10000 })) };
  const entities = { create: jest.fn(async (_u: string, _f: string, dto: any) => dto) };
  return { svc: new FinancePlanningService(prisma, permissions as any, { log: async () => undefined } as any, entities as any, { isConfigured: () => false } as any, automation as any), entities, permissions };
}

const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const txs = months.flatMap((m, i) => [
  { id: `in${i}`, attributes: { date: `${m}-05`, amount: 200000, currency: 'RUB' } },
  { id: `ex${i}`, attributes: { date: `${m}-10`, amount: -150000, currency: 'RUB' } },
  { id: `med${i}`, attributes: { date: `${m}-15`, amount: -5000, currency: 'RUB', categoryId: 'med' } },
  { id: `tr${i}`, attributes: { date: `${m}-20`, amount: -90000, currency: 'RUB', transactionType: 'TRANSFER' } }, // перевод — не расход
  { id: `pl${i}`, attributes: { date: `${m}-21`, amount: -99999, currency: 'RUB', isPlanned: true, plannedStatus: 'PLANNED' } }, // план — не факт
  { id: `usd${i}`, attributes: { date: `${m}-22`, amount: -300, currency: 'USD' } }, // другая валюта — не смешиваем
]);

describe('FinancePlanningService', () => {
  it('история: переводы, плановые и другая валюта не попадают; врачи — подсказка резерва', async () => {
    const { svc, permissions } = make(txs, []);
    const res = await svc.getPlan('u', 'fs', {}, '2026-11-07');
    expect(permissions.assertCan).toHaveBeenCalledWith(expect.anything(), 'FINANCE', 'VIEW');
    expect(res).toMatchObject({ monthlyCapacity: 45000, medianIncome: 200000, medianExpense: 155000, historyMonths: 6 });
    expect(res.categories[0]).toMatchObject({ categoryName: 'Медицина', averageMonthly: 5000, hasPlan: false });
    expect(res.suggestions.some((s) => s.kind === 'CATEGORY_NO_PLAN')).toBe(true);
  });

  it('личные планы с владельцем и фильтр по scope', async () => {
    const goals = [
      { id: 'g1', title: 'Отпуск', ownerPersonId: null, attributes: { name: 'Отпуск', targetAmount: 100000, deadline: '2027-05-07', scope: 'FAMILY', priority: 2 } },
      { id: 'g2', title: 'Курсы', ownerPersonId: 'p-arina', attributes: { name: 'Курсы', targetAmount: 40000, deadline: '2027-02-07', scope: 'PERSONAL', priority: 3 } },
    ];
    const { svc } = make(txs, goals);
    const all = await svc.getPlan('u', 'fs', {}, '2026-11-07');
    expect(all.plans.map((p) => p.name)).toEqual(['Отпуск', 'Курсы']);
    expect(all.plans[1].ownerName).toBe('Арина');
    const personal = await svc.getPlan('u', 'fs', { scope: 'PERSONAL' }, '2026-11-07');
    expect(personal.plans.map((p) => p.name)).toEqual(['Курсы']);
  });

  it('создание плана: личный без владельца — ошибка; резерв проверяет поля', async () => {
    const { svc, entities } = make([], []);
    await expect(svc.createPlan('u', 'fs', { name: 'X', planKind: 'TARGET', scope: 'PERSONAL', targetAmount: 100 })).rejects.toThrow('чей он');
    await expect(svc.createPlan('u', 'fs', { name: 'Стоматолог', planKind: 'RECURRING', scope: 'FAMILY', targetAmount: 20000 })).rejects.toThrow('периодичность');
    await svc.createPlan('u', 'fs', { name: 'Врачи', planKind: 'OPEN', scope: 'FAMILY', plannedMonthly: 6000, categoryId: 'med' });
    expect(entities.create.mock.calls[0][2].attributes).toMatchObject({ planKind: 'OPEN', plannedMonthly: 6000, linkedCategoryId: 'med', targetAmount: 72000 });
  });
});
