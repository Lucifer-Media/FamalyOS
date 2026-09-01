import { FinanceAnalyticsService } from '../finance-analytics.service';

function makeService(data: {
  accounts?: { id: string; ownerPersonId: string | null }[];
  persons?: { id: string; fullName: string }[];
  transactions?: { attributes: Record<string, unknown> }[];
}) {
  const prisma = {
    entity: {
      findMany: jest.fn(({ where }: any) => {
        if (where.entityType === 'bank_account') return Promise.resolve(data.accounts ?? []);
        if (where.entityType === 'financial_transaction') return Promise.resolve(data.transactions ?? []);
        return Promise.resolve([]);
      }),
    },
    person: {
      findMany: jest.fn().mockResolvedValue(data.persons ?? []),
    },
  };
  const permissions = {
    getMembership: jest.fn().mockResolvedValue({ role: 'OWNER' }),
    assertCan: jest.fn().mockResolvedValue(undefined),
  };
  return new FinanceAnalyticsService(prisma as any, permissions as any);
}

describe('FinanceAnalyticsService.getAnalyticsByParticipant', () => {
  it('группирует операции по владельцу счёта, на котором они произошли', async () => {
    const service = makeService({
      accounts: [
        { id: 'acc-max', ownerPersonId: 'person-max' },
        { id: 'acc-arina', ownerPersonId: 'person-arina' },
      ],
      persons: [
        { id: 'person-max', fullName: 'Максим' },
        { id: 'person-arina', fullName: 'Arina' },
      ],
      transactions: [
        { attributes: { accountId: 'acc-max', amount: -500, date: '2026-06-05' } },
        { attributes: { accountId: 'acc-max', amount: 50000, date: '2026-06-10' } },
        { attributes: { accountId: 'acc-arina', amount: -300, date: '2026-06-15' } },
      ],
    });
    const result = await service.getAnalyticsByParticipant('u1', 'f1', '2026-06-01', '2026-06-30');
    const max = result.find((r) => r.personName === 'Максим');
    const arina = result.find((r) => r.personName === 'Arina');
    expect(max).toMatchObject({ income: 50000, expense: 500, transactionCount: 2 });
    expect(arina).toMatchObject({ income: 0, expense: 300, transactionCount: 1 });
  });

  it('операции по счёту без владельца попадают в "Без владельца счёта"', async () => {
    const service = makeService({
      accounts: [{ id: 'acc-nobody', ownerPersonId: null }],
      persons: [],
      transactions: [{ attributes: { accountId: 'acc-nobody', amount: -100, date: '2026-06-05' } }],
    });
    const result = await service.getAnalyticsByParticipant('u1', 'f1', '2026-06-01', '2026-06-30');
    expect(result[0]).toMatchObject({ personId: null, personName: 'Без владельца счёта', expense: 100 });
  });

  it('плановые операции не учитываются', async () => {
    const service = makeService({
      accounts: [{ id: 'acc-max', ownerPersonId: 'person-max' }],
      persons: [{ id: 'person-max', fullName: 'Максим' }],
      transactions: [
        { attributes: { accountId: 'acc-max', amount: -500, date: '2026-06-05' } },
        { attributes: { accountId: 'acc-max', amount: -9999, date: '2026-06-06', isPlanned: true } },
      ],
    });
    const result = await service.getAnalyticsByParticipant('u1', 'f1', '2026-06-01', '2026-06-30');
    expect(result[0].expense).toBe(500);
  });
});

describe('FinanceAnalyticsService.getSpendingHeatmap', () => {
  it('возвращает каждый день диапазона, включая дни без трат', async () => {
    const service = makeService({
      transactions: [
        { attributes: { amount: -100, date: '2026-06-02' } },
        { attributes: { amount: -50, date: '2026-06-02' } },
      ],
    });
    const result = await service.getSpendingHeatmap('u1', 'f1', '2026-06-01', '2026-06-03');
    expect(result).toEqual([
      { date: '2026-06-01', expense: 0 },
      { date: '2026-06-02', expense: 150 },
      { date: '2026-06-03', expense: 0 },
    ]);
  });

  it('не учитывает доходы и плановые операции', async () => {
    const service = makeService({
      transactions: [
        { attributes: { amount: 5000, date: '2026-06-01' } },
        { attributes: { amount: -700, date: '2026-06-01', isPlanned: true } },
      ],
    });
    const result = await service.getSpendingHeatmap('u1', 'f1', '2026-06-01', '2026-06-01');
    expect(result).toEqual([{ date: '2026-06-01', expense: 0 }]);
  });
});
