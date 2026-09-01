import { PortfolioService } from '../portfolio.service';

function makeService(data: { accounts?: any[]; investments?: any[]; loans?: any[]; debts?: any[] }, findUniqueResult?: any) {
  const byType: Record<string, any[]> = {
    bank_account: data.accounts ?? [],
    investment_account: data.investments ?? [],
    loan_account: data.loans ?? [],
    debt: data.debts ?? [],
  };
  const prisma = {
    entity: {
      findMany: jest.fn(({ where }: any) => Promise.resolve(byType[where.entityType] ?? [])),
      findUnique: jest.fn().mockResolvedValue(findUniqueResult ?? null),
    },
  };
  const permissions = {
    getMembership: jest.fn().mockResolvedValue({ role: 'OWNER' }),
    assertCan: jest.fn().mockResolvedValue(undefined),
  };
  return new PortfolioService(prisma as any, permissions as any);
}

describe('PortfolioService.getNetWorth', () => {
  it('складывает наличные и инвестиции, вычитает кредиты и долги "я должен"', async () => {
    const service = makeService({
      accounts: [{ attributes: { currentBalance: 100000 } }, { attributes: { currentBalance: 50000 } }],
      investments: [{ attributes: { currentValue: 200000 } }],
      loans: [{ attributes: { currentBalance: 300000 } }],
      debts: [
        { attributes: { direction: 'I_OWE', remainingAmount: 20000 } },
        { attributes: { direction: 'OWED_TO_ME', remainingAmount: 15000 } },
      ],
    });
    const result = await service.getNetWorth('u1', 'f1');
    // 100000+50000+200000+15000(мне должны) - 300000(кредиты) - 20000(я должен)
    expect(result.netWorth).toBe(45000);
    expect(result.cashBalance).toBe(150000);
    expect(result.investmentsValue).toBe(200000);
    expect(result.loansBalance).toBe(300000);
    expect(result.debtsIOwe).toBe(20000);
    expect(result.debtsOwedToMe).toBe(15000);
  });

  it('при отсутствии данных возвращает нулевой Net Worth, а не падает', async () => {
    const service = makeService({});
    const result = await service.getNetWorth('u1', 'f1');
    expect(result.netWorth).toBe(0);
  });
});

describe('PortfolioService.getSchedule / simulateEarlyRepayment / compareRefinance', () => {
  const loan = {
    id: 'loan-1',
    familySpaceId: 'f1',
    entityType: 'loan_account',
    attributes: { currentBalance: 400000, interestRate: 15, termMonths: 24, principalAmount: 400000, monthlyPayment: undefined },
  };

  it('getSchedule строит график по данным реального кредита', async () => {
    const service = makeService({}, loan);
    const result = await service.getSchedule('u1', 'f1', 'loan-1');
    expect(result.loanId).toBe('loan-1');
    expect(result.schedule.length).toBeGreaterThan(0);
    expect(result.schedule[result.schedule.length - 1].remainingBalance).toBe(0);
  });

  it('для несуществующего кредита выбрасывает NotFoundException', async () => {
    const service = makeService({}, null);
    await expect(service.getSchedule('u1', 'f1', 'nope')).rejects.toThrow('Кредит не найден');
  });

  it('simulateEarlyRepayment требует положительную сумму', async () => {
    const service = makeService({}, loan);
    await expect(service.simulateEarlyRepayment('u1', 'f1', 'loan-1', { extraPayment: 0, fromPaymentNumber: 1, mode: 'REDUCE_TERM' })).rejects.toThrow(
      'больше нуля',
    );
  });

  it('compareRefinance требует ставку и срок', async () => {
    const service = makeService({}, loan);
    await expect(service.compareRefinance('u1', 'f1', 'loan-1', { annualRatePercent: 0, termMonths: 0 })).rejects.toThrow();
  });

  it('compareRefinance с корректными данными возвращает результат сравнения', async () => {
    const service = makeService({}, loan);
    const result = await service.compareRefinance('u1', 'f1', 'loan-1', { annualRatePercent: 8, termMonths: 24 });
    expect(result.savings).toBeGreaterThan(0);
  });
});
