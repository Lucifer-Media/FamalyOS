import { FinanceAnalyticsService } from '../finance-analytics.service';

function makeService(data: { accounts?: { id: string; title: string }[]; transactions?: { id: string; attributes: Record<string, unknown> }[] }) {
  const prisma = {
    entity: {
      findMany: jest.fn(({ where }: any) => {
        if (where.entityType === 'bank_account') return Promise.resolve(data.accounts ?? []);
        if (where.entityType === 'financial_transaction') return Promise.resolve(data.transactions ?? []);
        return Promise.resolve([]);
      }),
    },
  };
  const permissions = {
    getMembership: jest.fn().mockResolvedValue({ role: 'OWNER' }),
    assertCan: jest.fn().mockResolvedValue(undefined),
  };
  return new FinanceAnalyticsService(prisma as any, permissions as any);
}

describe('FinanceAnalyticsService.getTransferSummary', () => {
  it('считает связанную пару переводов один раз, с правильным направлением и суммой', async () => {
    const service = makeService({
      accounts: [
        { id: 'acc-a', title: 'Счёт А' },
        { id: 'acc-b', title: 'Счёт Б' },
      ],
      transactions: [
        { id: 'tx-out', attributes: { accountId: 'acc-a', amount: -1000, date: '2026-06-05', transactionType: 'TRANSFER', relatedTransactionId: 'tx-in' } },
        { id: 'tx-in', attributes: { accountId: 'acc-b', amount: 1000, date: '2026-06-05', transactionType: 'TRANSFER', relatedTransactionId: 'tx-out' } },
      ],
    });
    const result = await service.getTransferSummary('u1', 'f1', '2026-06-01', '2026-06-30');
    expect(result.totalCount).toBe(1);
    expect(result.totalVolume).toBe(1000);
    expect(result.byAccountPair).toEqual([
      { fromAccountId: 'acc-a', fromAccountName: 'Счёт А', toAccountId: 'acc-b', toAccountName: 'Счёт Б', amount: 1000, count: 1 },
    ]);
  });

  it('игнорирует TRANSFER-операции без пары (relatedTransactionId не задан)', async () => {
    const service = makeService({
      accounts: [{ id: 'acc-a', title: 'Счёт А' }],
      transactions: [{ id: 'tx-lonely', attributes: { accountId: 'acc-a', amount: -500, date: '2026-06-05', transactionType: 'TRANSFER' } }],
    });
    const result = await service.getTransferSummary('u1', 'f1', '2026-06-01', '2026-06-30');
    expect(result.totalCount).toBe(0);
    expect(result.byAccountPair).toEqual([]);
  });

  it('не учитывает обычные (не TRANSFER) операции', async () => {
    const service = makeService({
      accounts: [{ id: 'acc-a', title: 'Счёт А' }],
      transactions: [{ id: 'tx1', attributes: { accountId: 'acc-a', amount: -500, date: '2026-06-05', transactionType: 'EXPENSE' } }],
    });
    const result = await service.getTransferSummary('u1', 'f1', '2026-06-01', '2026-06-30');
    expect(result.totalCount).toBe(0);
  });

  it('фильтрует по дате и суммирует несколько переводов между одной парой счетов', async () => {
    const service = makeService({
      accounts: [
        { id: 'acc-a', title: 'Счёт А' },
        { id: 'acc-b', title: 'Счёт Б' },
      ],
      transactions: [
        { id: 'tx-out1', attributes: { accountId: 'acc-a', amount: -300, date: '2026-06-05', transactionType: 'TRANSFER', relatedTransactionId: 'tx-in1' } },
        { id: 'tx-in1', attributes: { accountId: 'acc-b', amount: 300, date: '2026-06-05', transactionType: 'TRANSFER', relatedTransactionId: 'tx-out1' } },
        { id: 'tx-out2', attributes: { accountId: 'acc-a', amount: -200, date: '2026-06-10', transactionType: 'TRANSFER', relatedTransactionId: 'tx-in2' } },
        { id: 'tx-in2', attributes: { accountId: 'acc-b', amount: 200, date: '2026-06-10', transactionType: 'TRANSFER', relatedTransactionId: 'tx-out2' } },
        // за пределами периода — не должен попасть
        { id: 'tx-out3', attributes: { accountId: 'acc-a', amount: -999, date: '2026-05-01', transactionType: 'TRANSFER', relatedTransactionId: 'tx-in3' } },
        { id: 'tx-in3', attributes: { accountId: 'acc-b', amount: 999, date: '2026-05-01', transactionType: 'TRANSFER', relatedTransactionId: 'tx-out3' } },
      ],
    });
    const result = await service.getTransferSummary('u1', 'f1', '2026-06-01', '2026-06-30');
    expect(result.totalCount).toBe(2);
    expect(result.totalVolume).toBe(500);
    expect(result.byAccountPair[0]).toMatchObject({ amount: 500, count: 2 });
  });
});
