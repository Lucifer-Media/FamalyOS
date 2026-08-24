import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';

export interface CategoryAnalytics {
  category: string;
  income: number;
  expense: number;
  net: number;
  transactionCount: number;
}

/**
 * Аналитика по операциям. Фильтрация — по `attributes.date` (фактическая
 * дата операции), а НЕ по `createdAt` (дата создания записи в БД) — при
 * импорте выписки за несколько лет все операции получают одинаковый
 * `createdAt` (момент импорта), что сломало бы аналитику для реальных
 * исторических данных, если фильтровать по нему.
 */
@Injectable()
export class FinanceAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async getAnalyticsByCategory(
    userId: string,
    familySpaceId: string,
    startDate: string,
    endDate: string,
  ): Promise<CategoryAnalytics[]> {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FINANCE', 'VIEW');

    const transactions = await this.prisma.entity.findMany({
      where: { familySpaceId, entityType: 'financial_transaction', status: 'ACTIVE' },
      select: { attributes: true },
    });

    const byCategory = new Map<string, { income: number; expense: number; count: number }>();

    for (const tx of transactions) {
      const attrs = tx.attributes as Record<string, unknown>;
      const date = String(attrs.date ?? '');
      if (!date || date < startDate || date > endDate) continue;

      const category = (attrs.category as string) || 'Без категории';
      const amount = Number(attrs.amount) || 0;
      const entry = byCategory.get(category) ?? { income: 0, expense: 0, count: 0 };
      if (amount >= 0) entry.income += amount;
      else entry.expense += Math.abs(amount);
      entry.count += 1;
      byCategory.set(category, entry);
    }

    return Array.from(byCategory.entries())
      .map(([category, data]) => ({
        category,
        income: Math.round(data.income * 100) / 100,
        expense: Math.round(data.expense * 100) / 100,
        net: Math.round((data.income - data.expense) * 100) / 100,
        transactionCount: data.count,
      }))
      .sort((a, b) => b.expense - a.expense);
  }

  /** Сравнение расходов за период с предыдущим таким же по длине периодом. */
  async compareWithPreviousPeriod(userId: string, familySpaceId: string, startDate: string, endDate: string) {
    const current = await this.getAnalyticsByCategory(userId, familySpaceId, startDate, endDate);
    const periodDays = Math.max(
      1,
      Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000),
    );
    const prevEnd = new Date(new Date(startDate).getTime() - 86400000).toISOString().slice(0, 10);
    const prevStart = new Date(new Date(startDate).getTime() - (periodDays + 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    const previous = await this.getAnalyticsByCategory(userId, familySpaceId, prevStart, prevEnd);

    const previousByCategory = new Map(previous.map((p) => [p.category, p.expense]));
    return current.map((c) => {
      const prevExpense = previousByCategory.get(c.category) ?? 0;
      const changePercent = prevExpense > 0 ? Math.round(((c.expense - prevExpense) / prevExpense) * 1000) / 10 : null;
      return { ...c, previousExpense: prevExpense, changePercent };
    });
  }

  /** Статус конкретного бюджета: выделено / потрачено / осталось. */
  async getBudgetStatus(userId: string, familySpaceId: string, budgetId: string) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FINANCE', 'VIEW');

    const budget = await this.prisma.entity.findUnique({ where: { id: budgetId } });
    if (!budget || budget.familySpaceId !== familySpaceId || budget.entityType !== 'budget') {
      return null;
    }
    const budgetAttrs = budget.attributes as Record<string, unknown>;

    const transactions = await this.prisma.entity.findMany({
      where: { familySpaceId, entityType: 'financial_transaction', status: 'ACTIVE' },
      select: { attributes: true },
    });

    let spent = 0;
    for (const tx of transactions) {
      const attrs = tx.attributes as Record<string, unknown>;
      if (attrs.budgetId !== budgetId) continue;
      const amount = Number(attrs.amount) || 0;
      if (amount < 0) spent += Math.abs(amount);
    }

    const planned = Number(budgetAttrs.plannedExpense) || 0;
    return {
      budgetId,
      budgetName: budget.title,
      plannedExpense: planned,
      spent: Math.round(spent * 100) / 100,
      remaining: Math.round((planned - spent) * 100) / 100,
      percentUsed: planned > 0 ? Math.round((spent / planned) * 1000) / 10 : null,
    };
  }
}
