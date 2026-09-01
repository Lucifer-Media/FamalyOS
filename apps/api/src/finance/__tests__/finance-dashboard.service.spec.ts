import { FinanceDashboardService } from '../finance-dashboard.service';

function makeService(data: {
  accounts?: { attributes: Record<string, unknown> }[];
  transactions?: { attributes: Record<string, unknown> }[];
  needs?: { id: string; title: string; attributes: Record<string, unknown> }[];
  goals?: { id: string; title: string; attributes: Record<string, unknown> }[];
  budgets?: { attributes: Record<string, unknown> }[];
}) {
  const prisma = {
    entity: {
      findMany: jest.fn((args: any) => {
        const type = args.where.entityType;
        if (type === 'bank_account') return Promise.resolve(data.accounts ?? []);
        if (type === 'financial_transaction') return Promise.resolve(data.transactions ?? []);
        if (type === 'financial_need') return Promise.resolve(data.needs ?? []);
        if (type === 'financial_goal') return Promise.resolve(data.goals ?? []);
        if (type === 'budget') return Promise.resolve(data.budgets ?? []);
        return Promise.resolve([]);
      }),
    },
  };
  const permissions = {
    getMembership: jest.fn().mockResolvedValue({ role: 'OWNER' }),
    assertCan: jest.fn().mockResolvedValue(undefined),
  };
  return new FinanceDashboardService(prisma as any, permissions as any);
}

describe('FinanceDashboardService — KPI дашборда', () => {
  it('суммирует баланс по всем счетам', async () => {
    const service = makeService({
      accounts: [{ attributes: { currentBalance: 50000 } }, { attributes: { currentBalance: 12000 } }],
    });
    const result = await service.getDashboard('u1', 'f1');
    expect(result.totalBalance).toBe(62000);
  });

  it('считает потрачено в текущем месяце только по операциям текущего месяца', async () => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString().slice(0, 10);
    const service = makeService({
      transactions: [
        { attributes: { date: thisMonth, amount: -1000, category: 'Продукты' } },
        { attributes: { date: lastMonth, amount: -5000, category: 'Продукты' } }, // не должно учитываться
      ],
    });
    const result = await service.getDashboard('u1', 'f1');
    expect(result.spentThisMonth).toBe(1000);
  });

  it('топ-категории отсортированы по убыванию суммы', async () => {
    const now = new Date();
    const d = now.toISOString().slice(0, 10);
    const service = makeService({
      transactions: [
        { attributes: { date: d, amount: -100, category: 'Транспорт' } },
        { attributes: { date: d, amount: -5000, category: 'Продукты' } },
        { attributes: { date: d, amount: -300, category: 'Транспорт' } },
      ],
    });
    const result = await service.getDashboard('u1', 'f1');
    expect(result.topCategories[0]).toMatchObject({ category: 'Продукты', amount: 5000 });
    expect(result.topCategories[1]).toMatchObject({ category: 'Транспорт', amount: 400 });
  });

  it('ближайшие обязательные платежи — только в пределах 7 дней от сегодня', async () => {
    const now = new Date();
    const in3Days = new Date(now);
    in3Days.setDate(in3Days.getDate() + 3);
    const in20Days = new Date(now);
    in20Days.setDate(in20Days.getDate() + 20);
    const service = makeService({
      needs: [
        { id: 'n1', title: 'Аренда', attributes: { amountMonthly: 30000, nextDueDate: in3Days.toISOString().slice(0, 10) } },
        { id: 'n2', title: 'Страховка', attributes: { amountMonthly: 5000, nextDueDate: in20Days.toISOString().slice(0, 10) } },
      ],
    });
    const result = await service.getDashboard('u1', 'f1');
    expect(result.upcomingNeeds).toHaveLength(1);
    expect(result.upcomingNeeds[0].name).toBe('Аренда');
  });

  it('прогресс цели считается только по операциям со связанной категорией', async () => {
    const now = new Date();
    const d = now.toISOString().slice(0, 10);
    const service = makeService({
      goals: [{ id: 'g1', title: 'На отпуск', attributes: { targetAmount: 100000, linkedCategoryId: 'cat-savings' } }],
      transactions: [
        { attributes: { date: d, amount: 10000, categoryId: 'cat-savings' } },
        { attributes: { date: d, amount: 20000, categoryId: 'cat-other' } }, // не должно учитываться
      ],
    });
    const result = await service.getDashboard('u1', 'f1');
    expect(result.goalsProgress[0]).toMatchObject({ name: 'На отпуск', targetAmount: 100000, currentAmount: 10000 });
  });

  it('цель без связанной категории — прогресс 0, не выдумывается', async () => {
    const service = makeService({
      goals: [{ id: 'g1', title: 'Без категории', attributes: { targetAmount: 50000 } }],
    });
    const result = await service.getDashboard('u1', 'f1');
    expect(result.goalsProgress[0].currentAmount).toBe(0);
  });
});
