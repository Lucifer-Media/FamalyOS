import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { isActualTransaction } from './finance-analytics.service';

export interface DashboardData {
  totalBalance: number;
  spentThisMonth: number;
  plannedThisMonth: number;
  daysLeftInMonth: number;
  dailyBudgetRemaining: number | null;
  upcomingNeeds: { id: string; name: string; amountMonthly: number; nextDueDate: string; priority: string }[];
  topCategories: { category: string; amount: number }[];
  monthlyTrend: { month: string; income: number; expense: number }[];
  goalsProgress: { id: string; name: string; targetAmount: number; currentAmount: number; deadline?: string }[];
}

/**
 * Агрегация для главного финансового дашборда — KPI, расходы по
 * категориям, тренд, ближайшие обязательные платежи, прогресс целей. Все
 * суммы считаются здесь, в коде — не моделью и не на фронтенде.
 */
@Injectable()
export class FinanceDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async getDashboard(userId: string, familySpaceId: string): Promise<DashboardData> {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FINANCE', 'VIEW');

    const [accounts, transactions, needs, goals, budgets] = await Promise.all([
      this.prisma.entity.findMany({
        where: { familySpaceId, entityType: 'bank_account', status: 'ACTIVE' },
        select: { attributes: true },
      }),
      this.prisma.entity.findMany({
        where: { familySpaceId, entityType: 'financial_transaction', status: 'ACTIVE' },
        select: { attributes: true },
      }),
      this.prisma.entity.findMany({
        where: { familySpaceId, entityType: 'financial_need', status: 'ACTIVE' },
        select: { id: true, title: true, attributes: true },
      }),
      this.prisma.entity.findMany({
        where: { familySpaceId, entityType: 'financial_goal', status: 'ACTIVE' },
        select: { id: true, title: true, attributes: true },
      }),
      this.prisma.entity.findMany({
        where: { familySpaceId, entityType: 'budget', status: 'ACTIVE' },
        select: { attributes: true },
      }),
    ]);

    const totalBalance = accounts.reduce((sum: number, a: { attributes: unknown }) => {
      const balance = Number((a.attributes as Record<string, unknown>).currentBalance) || 0;
      return sum + balance;
    }, 0);

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeftInMonth = daysInMonth - now.getDate() + 1;

    let spentThisMonth = 0;
    const categoryTotals = new Map<string, number>();
    const monthlyTotals = new Map<string, { income: number; expense: number }>();

    for (const tx of transactions) {
      const a = tx.attributes as Record<string, unknown>;
      if (!isActualTransaction(a)) continue; // плановые операции — не факт
      const date = String(a.date ?? '');
      if (!date) continue;
      const amount = Number(a.amount) || 0;

      if (date >= monthStart && amount < 0) spentThisMonth += Math.abs(amount);

      if (amount < 0) {
        const cat = String(a.category ?? 'Без категории');
        categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + Math.abs(amount));
      }

      const monthKey = date.slice(0, 7);
      const monthsAgo = monthsBetween(monthKey, now);
      if (monthsAgo >= 0 && monthsAgo < 6) {
        const entry = monthlyTotals.get(monthKey) ?? { income: 0, expense: 0 };
        if (amount >= 0) entry.income += amount;
        else entry.expense += Math.abs(amount);
        monthlyTotals.set(monthKey, entry);
      }
    }

    const plannedThisMonth = budgets.reduce((sum: number, b: { attributes: unknown }) => {
      const attrs = b.attributes as Record<string, unknown>;
      const start = String(attrs.startDate ?? '');
      const end = attrs.endDate ? String(attrs.endDate) : '9999-12-31';
      if (start && start <= `${monthStart.slice(0, 7)}-31` && end >= monthStart) {
        return sum + (Number(attrs.plannedExpense) || 0);
      }
      return sum;
    }, 0);

    const dailyBudgetRemaining =
      plannedThisMonth > 0 ? Math.round(((plannedThisMonth - spentThisMonth) / daysLeftInMonth) * 100) / 100 : null;

    const in7Days = new Date(now);
    in7Days.setDate(in7Days.getDate() + 7);
    const in7DaysIso = in7Days.toISOString().slice(0, 10);
    const todayIso = now.toISOString().slice(0, 10);

    const upcomingNeeds = needs
      .map((n: { id: string; title: string; attributes: unknown }) => {
        const a = n.attributes as Record<string, unknown>;
        return {
          id: n.id,
          name: n.title,
          amountMonthly: Number(a.amountMonthly) || 0,
          nextDueDate: String(a.nextDueDate ?? ''),
          priority: String(a.priority ?? 'IMPORTANT'),
        };
      })
      .filter((n: { nextDueDate: string }) => n.nextDueDate && n.nextDueDate >= todayIso && n.nextDueDate <= in7DaysIso)
      .sort((a: { nextDueDate: string }, b: { nextDueDate: string }) => (a.nextDueDate < b.nextDueDate ? -1 : 1));

    const topCategories = Array.from(categoryTotals.entries())
      .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    const monthlyTrend = Array.from(monthlyTotals.entries())
      .map(([month, v]) => ({ month, income: Math.round(v.income * 100) / 100, expense: Math.round(v.expense * 100) / 100 }))
      .sort((a, b) => (a.month < b.month ? -1 : 1));

    const goalsProgress = goals.map((g: { id: string; title: string; attributes: unknown }) => {
      const a = g.attributes as Record<string, unknown>;
      const linkedCategoryId = a.linkedCategoryId as string | undefined;
      let currentAmount = 0;
      if (linkedCategoryId) {
        for (const tx of transactions) {
          const txAttrs = tx.attributes as Record<string, unknown>;
          if (!isActualTransaction(txAttrs)) continue;
          if (txAttrs.categoryId === linkedCategoryId) {
            const amount = Number(txAttrs.amount) || 0;
            if (amount > 0) currentAmount += amount;
          }
        }
      }
      return {
        id: g.id,
        name: g.title,
        targetAmount: Number(a.targetAmount) || 0,
        currentAmount: Math.round(currentAmount * 100) / 100,
        deadline: a.deadline ? String(a.deadline) : undefined,
      };
    });

    return {
      totalBalance: Math.round(totalBalance * 100) / 100,
      spentThisMonth: Math.round(spentThisMonth * 100) / 100,
      plannedThisMonth: Math.round(plannedThisMonth * 100) / 100,
      daysLeftInMonth,
      dailyBudgetRemaining,
      upcomingNeeds,
      topCategories,
      monthlyTrend,
      goalsProgress,
    };
  }
}

function monthsBetween(monthKey: string, now: Date): number {
  const [y, m] = monthKey.split('-').map(Number);
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
}
