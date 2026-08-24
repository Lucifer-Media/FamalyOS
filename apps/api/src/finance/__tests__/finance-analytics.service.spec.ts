import { FinanceAnalyticsService } from '../finance-analytics.service';

function makeService(transactions: { attributes: Record<string, unknown> }[], budget?: any) {
  const prisma = {
    entity: {
      findMany: jest.fn().mockResolvedValue(transactions),
      findUnique: jest.fn().mockResolvedValue(budget ?? null),
    },
  };
  const permissions = {
    getMembership: jest.fn().mockResolvedValue({ role: 'OWNER' }),
    assertCan: jest.fn().mockResolvedValue(undefined),
  };
  return new FinanceAnalyticsService(prisma as any, permissions as any);
}

describe('FinanceAnalyticsService — агрегация по дате ОПЕРАЦИИ, не по дате создания записи в БД', () => {
  it('РЕГРЕССИЯ: фильтрует по attributes.date, не по createdAt — иначе импорт исторической выписки ломает аналитику', async () => {
    const service = makeService([
      { attributes: { date: '2022-01-15', amount: -1000, category: 'Продукты' } },
      { attributes: { date: '2024-06-01', amount: -2000, category: 'Продукты' } },
      { attributes: { date: '2026-06-15', amount: -1593.28, category: 'ЖКХ' } },
    ]);
    const result = await service.getAnalyticsByCategory('u1', 'f1', '2026-06-01', '2026-06-30');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ category: 'ЖКХ', expense: 1593.28 });
  });

  it('корректно разделяет доходы и расходы по категориям', async () => {
    const service = makeService([
      { attributes: { date: '2026-06-05', amount: -500, category: 'Транспорт' } },
      { attributes: { date: '2026-06-10', amount: 50000, category: 'Зарплата' } },
      { attributes: { date: '2026-06-15', amount: -300, category: 'Транспорт' } },
    ]);
    const result = await service.getAnalyticsByCategory('u1', 'f1', '2026-06-01', '2026-06-30');
    const transport = result.find((r) => r.category === 'Транспорт');
    expect(transport).toMatchObject({ expense: 800, income: 0, transactionCount: 2 });
  });

  it('операции без категории группируются как "Без категории"', async () => {
    const service = makeService([{ attributes: { date: '2026-06-05', amount: -100 } }]);
    const result = await service.getAnalyticsByCategory('u1', 'f1', '2026-06-01', '2026-06-30');
    expect(result[0].category).toBe('Без категории');
  });
});

describe('FinanceAnalyticsService.getBudgetStatus', () => {
  it('считает потрачено только по операциям, реально связанным с этим бюджетом', async () => {
    const budget = { id: 'b1', title: 'Бюджет на еду (июнь)', familySpaceId: 'f1', entityType: 'budget', attributes: { plannedExpense: 20000 } };
    const service = makeService(
      [
        { attributes: { budgetId: 'b1', amount: -5000 } },
        { attributes: { budgetId: 'b1', amount: -3000 } },
        { attributes: { budgetId: 'other-budget', amount: -10000 } },
        { attributes: { budgetId: 'b1', amount: 1000 } },
      ],
      budget,
    );
    const status = await service.getBudgetStatus('u1', 'f1', 'b1');
    expect(status).toMatchObject({ plannedExpense: 20000, spent: 8000, remaining: 12000, percentUsed: 40 });
  });

  it('для несуществующего бюджета возвращает null, не выдумывает данные', async () => {
    const service = makeService([]);
    const status = await service.getBudgetStatus('u1', 'f1', 'nonexistent');
    expect(status).toBeNull();
  });
});
