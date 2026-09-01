/**
 * Расчёты для раздела «Портфель» (кредиты/ипотека) — аннуитетный график
 * платежей, симуляция досрочного погашения (сокращение срока или сокращение
 * платежа), сравнение выгоды рефинансирования. Чистые функции без Prisma —
 * тестируются в изоляции (см. budget-periods.ts — тот же паттерн).
 *
 * Все суммы считаются кодом, не языковой моделью — ключевой принцип проекта.
 */

export interface ScheduleRow {
  paymentNumber: number;
  date: string; // YYYY-MM-DD
  payment: number;
  principalPart: number;
  interestPart: number;
  remainingBalance: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addMonths(dateIso: string, months: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Аннуитетный ежемесячный платёж по стандартной формуле. */
export function annuityPayment(principal: number, annualRatePercent: number, termMonths: number): number {
  if (termMonths <= 0) return principal;
  const monthlyRate = annualRatePercent / 100 / 12;
  if (monthlyRate === 0) return round2(principal / termMonths);
  const payment = (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));
  return round2(payment);
}

/**
 * Строит полный аннуитетный график платежей от текущего остатка до нуля.
 * Последний платёж корректируется так, чтобы остаток точно ушёл в 0
 * (защита от накопления копеечных ошибок округления).
 */
export function buildAmortizationSchedule(params: {
  currentBalance: number;
  annualRatePercent: number;
  remainingTermMonths: number;
  nextPaymentDate: string;
  fixedMonthlyPayment?: number;
}): ScheduleRow[] {
  const { currentBalance, annualRatePercent, remainingTermMonths, nextPaymentDate } = params;
  const monthlyRate = annualRatePercent / 100 / 12;
  const payment = params.fixedMonthlyPayment ?? annuityPayment(currentBalance, annualRatePercent, remainingTermMonths);

  const rows: ScheduleRow[] = [];
  let balance = currentBalance;
  for (let i = 1; i <= remainingTermMonths && balance > 0.005; i++) {
    const interestPart = round2(balance * monthlyRate);
    let principalPart = round2(payment - interestPart);
    let actualPayment = payment;
    // Последний платёж графика или платёж, который перекрывает остаток —
    // закрываем кредит точно в ноль, а не оставляем копеечный хвост
    // от накопленных округлений.
    if (principalPart >= balance || i === remainingTermMonths) {
      principalPart = round2(balance);
      actualPayment = round2(principalPart + interestPart);
      balance = 0;
    } else {
      balance = round2(balance - principalPart);
    }
    rows.push({
      paymentNumber: i,
      date: addMonths(nextPaymentDate, i - 1),
      payment: actualPayment,
      principalPart,
      interestPart,
      remainingBalance: balance,
    });
  }
  return rows;
}

export interface EarlyRepaymentResult {
  schedule: ScheduleRow[];
  totalInterestBefore: number;
  totalInterestAfter: number;
  interestSaved: number;
  monthsBefore: number;
  monthsAfter: number;
  monthsSaved: number;
}

/**
 * Симулирует единоразовый досрочный платёж, применённый перед указанным
 * номером платежа (fromPaymentNumber). Два режима:
 *   - REDUCE_TERM: платёж остаётся прежним, срок сокращается;
 *   - REDUCE_PAYMENT: срок остаётся прежним, платёж уменьшается.
 */
export function simulateEarlyRepayment(
  params: {
    currentBalance: number;
    annualRatePercent: number;
    remainingTermMonths: number;
    nextPaymentDate: string;
    fixedMonthlyPayment?: number;
  },
  extraPayment: number,
  fromPaymentNumber: number,
  mode: 'REDUCE_TERM' | 'REDUCE_PAYMENT',
): EarlyRepaymentResult {
  const baseline = buildAmortizationSchedule(params);
  const totalInterestBefore = round2(baseline.reduce((s, r) => s + r.interestPart, 0));

  const payment = params.fixedMonthlyPayment ?? annuityPayment(params.currentBalance, params.annualRatePercent, params.remainingTermMonths);
  const monthlyRate = params.annualRatePercent / 100 / 12;

  // Проигрываем график заново, применяя extraPayment сразу после платежа fromPaymentNumber-1.
  const rows: ScheduleRow[] = [];
  let balance = params.currentBalance;
  let currentPayment = payment;
  for (let i = 1; balance > 0.005 && i <= 1200; i++) {
    if (i === fromPaymentNumber) {
      balance = round2(Math.max(0, balance - extraPayment));
      if (balance <= 0.005) break;
      if (mode === 'REDUCE_PAYMENT') {
        const remaining = params.remainingTermMonths - (i - 1);
        currentPayment = annuityPayment(balance, params.annualRatePercent, Math.max(1, remaining));
      }
    }
    const interestPart = round2(balance * monthlyRate);
    let principalPart = round2(currentPayment - interestPart);
    let actualPayment = currentPayment;
    if (principalPart >= balance) {
      principalPart = round2(balance);
      actualPayment = round2(principalPart + interestPart);
      balance = 0;
    } else {
      balance = round2(balance - principalPart);
    }
    rows.push({
      paymentNumber: i,
      date: addMonths(params.nextPaymentDate, i - 1),
      payment: actualPayment,
      principalPart,
      interestPart,
      remainingBalance: balance,
    });
  }

  const totalInterestAfter = round2(rows.reduce((s, r) => s + r.interestPart, 0));
  return {
    schedule: rows,
    totalInterestBefore,
    totalInterestAfter,
    interestSaved: round2(totalInterestBefore - totalInterestAfter),
    monthsBefore: baseline.length,
    monthsAfter: rows.length,
    monthsSaved: baseline.length - rows.length,
  };
}

export interface RefinanceComparisonResult {
  currentTotalCost: number; // остаток долга к выплате по текущим условиям (тело + проценты)
  newTotalCost: number; // тело + проценты + комиссии по новому кредиту
  savings: number; // положительное — рефинансирование выгодно
  newMonthlyPayment: number;
  currentMonthlyPayment: number;
}

/** Сравнивает текущий кредит с гипотетическим новым (для рефинансирования). */
export function compareRefinancing(
  current: { currentBalance: number; annualRatePercent: number; remainingTermMonths: number; nextPaymentDate: string; fixedMonthlyPayment?: number },
  proposed: { annualRatePercent: number; termMonths: number; feesFlat?: number },
): RefinanceComparisonResult {
  const currentSchedule = buildAmortizationSchedule(current);
  const currentTotalCost = round2(currentSchedule.reduce((s, r) => s + r.payment, 0));
  const currentMonthlyPayment =
    current.fixedMonthlyPayment ?? annuityPayment(current.currentBalance, current.annualRatePercent, current.remainingTermMonths);

  const newMonthlyPayment = annuityPayment(current.currentBalance, proposed.annualRatePercent, proposed.termMonths);
  const newTotalCost = round2(newMonthlyPayment * proposed.termMonths + (proposed.feesFlat ?? 0));

  return {
    currentTotalCost,
    newTotalCost,
    savings: round2(currentTotalCost - newTotalCost),
    newMonthlyPayment,
    currentMonthlyPayment,
  };
}

/** Прогноз стоимости вклада/инвестиции по сложным процентам — три сценария. */
export interface InvestmentForecast {
  years: number;
  pessimistic: number;
  base: number;
  optimistic: number;
}

export function forecastInvestment(currentValue: number, baseAnnualReturnPercent: number, years: number): InvestmentForecast {
  const compound = (ratePercent: number) => round2(currentValue * Math.pow(1 + ratePercent / 100, years));
  return {
    years,
    pessimistic: compound(Math.max(0, baseAnnualReturnPercent - 5)),
    base: compound(baseAnnualReturnPercent),
    optimistic: compound(baseAnnualReturnPercent + 5),
  };
}
