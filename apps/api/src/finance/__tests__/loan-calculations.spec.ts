import {
  annuityPayment,
  buildAmortizationSchedule,
  simulateEarlyRepayment,
  compareRefinancing,
  forecastInvestment,
} from '../loan-calculations';

describe('annuityPayment', () => {
  it('считает аннуитетный платёж по стандартной формуле', () => {
    // 1 000 000 под 12% годовых на 12 месяцев — классический пример,
    // проверено внешним калькулятором: ~88 849р
    const payment = annuityPayment(1_000_000, 12, 12);
    expect(payment).toBeCloseTo(88849.15, 0);
  });

  it('при нулевой ставке делит сумму поровну', () => {
    expect(annuityPayment(12000, 0, 12)).toBe(1000);
  });
});

describe('buildAmortizationSchedule', () => {
  it('график заканчивается нулевым остатком, а не уходит в минус/зависает', () => {
    const schedule = buildAmortizationSchedule({
      currentBalance: 500000,
      annualRatePercent: 15,
      remainingTermMonths: 24,
      nextPaymentDate: '2026-10-01',
    });
    expect(schedule.length).toBe(24);
    expect(schedule[schedule.length - 1].remainingBalance).toBe(0);
  });

  it('сумма долевых частей тела кредита равна исходному остатку', () => {
    const schedule = buildAmortizationSchedule({
      currentBalance: 200000,
      annualRatePercent: 10,
      remainingTermMonths: 12,
      nextPaymentDate: '2026-01-15',
    });
    const totalPrincipal = schedule.reduce((s, r) => s + r.principalPart, 0);
    expect(Math.round(totalPrincipal)).toBe(200000);
  });

  it('даты платежей идут помесячно от указанной даты следующего платежа', () => {
    const schedule = buildAmortizationSchedule({
      currentBalance: 100000,
      annualRatePercent: 10,
      remainingTermMonths: 3,
      nextPaymentDate: '2026-01-15',
    });
    expect(schedule.map((r) => r.date)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });
});

describe('simulateEarlyRepayment', () => {
  const base = {
    currentBalance: 500000,
    annualRatePercent: 15,
    remainingTermMonths: 24,
    nextPaymentDate: '2026-10-01',
  };

  it('REDUCE_TERM: досрочный платёж сокращает срок и экономит проценты', () => {
    const result = simulateEarlyRepayment(base, 100000, 3, 'REDUCE_TERM');
    expect(result.monthsAfter).toBeLessThan(result.monthsBefore);
    expect(result.interestSaved).toBeGreaterThan(0);
    expect(result.schedule[result.schedule.length - 1].remainingBalance).toBe(0);
  });

  it('REDUCE_PAYMENT: досрочный платёж сохраняет срок, но тоже экономит проценты', () => {
    const result = simulateEarlyRepayment(base, 100000, 3, 'REDUCE_PAYMENT');
    expect(result.interestSaved).toBeGreaterThan(0);
    // Срок почти не меняется в этом режиме (может отличаться на 1 из-за округлений)
    expect(Math.abs(result.monthsAfter - result.monthsBefore)).toBeLessThanOrEqual(1);
  });

  it('досрочное погашение всей суммы сразу закрывает кредит', () => {
    const result = simulateEarlyRepayment(base, 500000, 1, 'REDUCE_TERM');
    expect(result.monthsAfter).toBe(0);
    expect(result.totalInterestAfter).toBe(0);
  });
});

describe('compareRefinancing', () => {
  it('более низкая ставка рефинансирования даёт положительную экономию', () => {
    const result = compareRefinancing(
      { currentBalance: 1000000, annualRatePercent: 18, remainingTermMonths: 24, nextPaymentDate: '2026-10-01' },
      { annualRatePercent: 10, termMonths: 24 },
    );
    expect(result.savings).toBeGreaterThan(0);
    expect(result.newMonthlyPayment).toBeLessThan(result.currentMonthlyPayment);
  });

  it('комиссия за рефинансирование уменьшает экономию', () => {
    const withoutFees = compareRefinancing(
      { currentBalance: 1000000, annualRatePercent: 18, remainingTermMonths: 24, nextPaymentDate: '2026-10-01' },
      { annualRatePercent: 10, termMonths: 24 },
    );
    const withFees = compareRefinancing(
      { currentBalance: 1000000, annualRatePercent: 18, remainingTermMonths: 24, nextPaymentDate: '2026-10-01' },
      { annualRatePercent: 10, termMonths: 24, feesFlat: 50000 },
    );
    expect(withFees.savings).toBeLessThan(withoutFees.savings);
    expect(withoutFees.savings - withFees.savings).toBeCloseTo(50000, 0);
  });

  it('невыгодное рефинансирование (более высокая ставка) даёт отрицательную экономию', () => {
    const result = compareRefinancing(
      { currentBalance: 1000000, annualRatePercent: 8, remainingTermMonths: 24, nextPaymentDate: '2026-10-01' },
      { annualRatePercent: 20, termMonths: 24 },
    );
    expect(result.savings).toBeLessThan(0);
  });
});

describe('forecastInvestment', () => {
  it('базовый сценарий растёт по сложному проценту', () => {
    const result = forecastInvestment(100000, 10, 1);
    expect(result.base).toBeCloseTo(110000, 0);
  });

  it('пессимистичный сценарий ниже базового, оптимистичный — выше', () => {
    const result = forecastInvestment(100000, 10, 5);
    expect(result.pessimistic).toBeLessThan(result.base);
    expect(result.optimistic).toBeGreaterThan(result.base);
  });

  it('пессимистичный сценарий не уходит в отрицательную доходность ниже нуля', () => {
    const result = forecastInvestment(100000, 2, 3);
    expect(result.pessimistic).toBeGreaterThanOrEqual(100000 * Math.pow(1, 3) * 0.999);
  });
});
