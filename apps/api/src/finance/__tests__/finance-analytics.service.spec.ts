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
  it('считает потрачено по операциям, явно связанным с этим бюджетом (budgetId)', async () => {
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

  it('РЕГРЕССИЯ: считает потрачено по категории+периоду, даже БЕЗ явной привязки budgetId (реальный баг — раньше бюджет всегда показывал 0)', async () => {
    const budget = {
      id: 'b1',
      title: 'Продукты',
      familySpaceId: 'f1',
      entityType: 'budget',
      attributes: { plannedExpense: 30000, categories: 'Продукты', startDate: '2026-08-01', endDate: '2026-08-31' },
    };
    const service = makeService(
      [
        // Реальные операции с вашей выписки — категория "Продукты", без явного budgetId
        { attributes: { category: 'Продукты', amount: -632.43, date: '2026-08-21' } },
        { attributes: { category: 'Продукты', amount: -238, date: '2026-08-19' } },
        { attributes: { category: 'Продукты', amount: -1645.48, date: '2026-08-19' } },
        { attributes: { category: 'Фастфуд', amount: -2133, date: '2026-08-22' } }, // другая категория — не должна учитываться
        { attributes: { category: 'Продукты', amount: -500, date: '2026-07-15' } }, // вне периода бюджета
      ],
      budget,
    );
    const status = await service.getBudgetStatus('u1', 'f1', 'b1');
    expect(status?.spent).toBeCloseTo(632.43 + 238 + 1645.48, 2);
  });

  it('при наличии categoryId у бюджета — сопоставляет операции по справочной категории, а не по тексту', async () => {
    const budget = {
      id: 'b2',
      title: 'Продукты (справочник)',
      familySpaceId: 'f1',
      entityType: 'budget',
      attributes: { plannedExpense: 20000, categoryId: 'cat-groceries', startDate: '2026-08-01', endDate: '2026-08-31' },
    };
    const service = makeService(
      [
        { attributes: { categoryId: 'cat-groceries', amount: -1000, date: '2026-08-05' } },
        { attributes: { categoryId: 'cat-groceries', amount: -500, date: '2026-08-10' } },
        // Другая категория из справочника — не должна учитываться, даже если текстовое поле совпадает
        { attributes: { categoryId: 'cat-other', category: 'Продукты', amount: -9999, date: '2026-08-10' } },
      ],
      budget,
    );
    const status = await service.getBudgetStatus('u1', 'f1', 'b2');
    expect(status?.spent).toBeCloseTo(1500, 2);
  });

  it('для несуществующего бюджета возвращает null, не выдумывает данные', async () => {
    const service = makeService([]);
    const status = await service.getBudgetStatus('u1', 'f1', 'nonexistent');
    expect(status).toBeNull();
  });
});
