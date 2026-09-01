import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { buildAmortizationSchedule, simulateEarlyRepayment, compareRefinancing } from './loan-calculations';

export interface NetWorthBreakdown {
  cashBalance: number;
  investmentsValue: number;
  loansBalance: number;
  debtsIOwe: number;
  debtsOwedToMe: number;
  netWorth: number;
}

/**
 * Агрегация раздела «Портфель» — Net Worth в реальном времени (пункт
 * запроса на доработку) и обёртки над чистыми расчётами кредитов
 * (loan-calculations.ts) поверх реальных данных сущности `loan_account`.
 */
@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async getNetWorth(userId: string, familySpaceId: string): Promise<NetWorthBreakdown> {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FINANCE', 'VIEW');

    const [accounts, investments, loans, debts] = await Promise.all([
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'bank_account', status: 'ACTIVE' }, select: { attributes: true } }),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'investment_account', status: 'ACTIVE' }, select: { attributes: true } }),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'loan_account', status: 'ACTIVE' }, select: { attributes: true } }),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'debt', status: 'ACTIVE' }, select: { attributes: true } }),
    ]);

    const cashBalance = sumAttr(accounts, 'currentBalance');
    const investmentsValue = sumAttr(investments, 'currentValue');
    const loansBalance = sumAttr(loans, 'currentBalance');
    const debtsIOwe = (debts as { attributes: unknown }[])
      .filter((d) => (d.attributes as any).direction === 'I_OWE')
      .reduce((s: number, d) => s + (Number((d.attributes as any).remainingAmount) || 0), 0);
    const debtsOwedToMe = (debts as { attributes: unknown }[])
      .filter((d) => (d.attributes as any).direction === 'OWED_TO_ME')
      .reduce((s: number, d) => s + (Number((d.attributes as any).remainingAmount) || 0), 0);

    const netWorth = cashBalance + investmentsValue + debtsOwedToMe - loansBalance - debtsIOwe;

    return {
      cashBalance: round2(cashBalance),
      investmentsValue: round2(investmentsValue),
      loansBalance: round2(loansBalance),
      debtsIOwe: round2(debtsIOwe),
      debtsOwedToMe: round2(debtsOwedToMe),
      netWorth: round2(netWorth),
    };
  }

  private async loadLoan(userId: string, familySpaceId: string, loanId: string) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FINANCE', 'VIEW');
    const loan = await this.prisma.entity.findUnique({ where: { id: loanId } });
    if (!loan || loan.familySpaceId !== familySpaceId || loan.entityType !== 'loan_account') {
      throw new NotFoundException('Кредит не найден');
    }
    return loan;
  }

  private scheduleParamsFor(loan: { attributes: unknown }) {
    const a = loan.attributes as Record<string, unknown>;
    const currentBalance = Number(a.currentBalance) || 0;
    const annualRatePercent = Number(a.interestRate) || 0;
    const termMonths = Number(a.termMonths) || 0;
    const principalAmount = Number(a.principalAmount) || currentBalance;
    // Оставшийся срок оцениваем пропорционально доле уже погашенного тела —
    // в схеме нет отдельного поля "осталось платежей", считаем от суммы.
    const paidFraction = principalAmount > 0 ? 1 - currentBalance / principalAmount : 0;
    const remainingTermMonths = Math.max(1, Math.round(termMonths * (1 - paidFraction)));
    const nextPaymentDate = new Date().toISOString().slice(0, 10);
    const fixedMonthlyPayment = a.monthlyPayment ? Number(a.monthlyPayment) : undefined;
    return { currentBalance, annualRatePercent, remainingTermMonths, nextPaymentDate, fixedMonthlyPayment };
  }

  async getSchedule(userId: string, familySpaceId: string, loanId: string) {
    const loan = await this.loadLoan(userId, familySpaceId, loanId);
    return { loanId, schedule: buildAmortizationSchedule(this.scheduleParamsFor(loan)) };
  }

  async simulateEarlyRepayment(
    userId: string,
    familySpaceId: string,
    loanId: string,
    dto: { extraPayment: number; fromPaymentNumber: number; mode: 'REDUCE_TERM' | 'REDUCE_PAYMENT' },
  ) {
    if (!dto.extraPayment || dto.extraPayment <= 0) {
      throw new BadRequestException('Сумма досрочного платежа должна быть больше нуля');
    }
    const loan = await this.loadLoan(userId, familySpaceId, loanId);
    return simulateEarlyRepayment(this.scheduleParamsFor(loan), dto.extraPayment, dto.fromPaymentNumber || 1, dto.mode || 'REDUCE_TERM');
  }

  async compareRefinance(
    userId: string,
    familySpaceId: string,
    loanId: string,
    dto: { annualRatePercent: number; termMonths: number; feesFlat?: number },
  ) {
    if (!dto.annualRatePercent || !dto.termMonths) {
      throw new BadRequestException('Укажите ставку и срок нового кредита');
    }
    const loan = await this.loadLoan(userId, familySpaceId, loanId);
    return compareRefinancing(this.scheduleParamsFor(loan), dto);
  }
}

function sumAttr(entities: { attributes: unknown }[], key: string): number {
  return entities.reduce((s, e) => s + (Number((e.attributes as Record<string, unknown>)[key]) || 0), 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
