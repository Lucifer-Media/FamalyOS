import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { computePeriodBreakdown, PeriodAllocation, BudgetPeriodType } from './budget-periods';

/**
 * Плановая операция не должна попадать в факт, пока не подтверждена как
 * совершившаяся. Считается фактической операцией:
 *   - любая обычная операция (isPlanned не true);
 *   - плановая операция со статусом COMPLETED (пользователь подтвердил,
 *     что она действительно произошла).
 * НЕ считается фактом: plannedStatus === 'PLANNED' (ещё не наступила) и
 * 'CANCELLED' (отменена, не должна попадать ни в факт, ни оставаться
 * "потраченной суммой").
 */
export function isActualTransaction(attrs: Record<string, unknown>): boolean {
  if (attrs.isPlanned !== true) return true;
  return attrs.plannedStatus === 'COMPLETED';
}

/** Аналитика по владельцу счёта (участнику семьи) — пункт "аналитика по участникам". */
export interface ParticipantAnalytics {
  personId: string | null;
  personName: string;
  income: number;
  expense: number;
  net: number;
  transactionCount: number;
}

/** Один день для тепловой карты расходов. */
export interface HeatmapDay {
  date: string;
  expense: number;
}

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
      if (!isActualTransaction(attrs)) continue; // плановые операции не входят в факт
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

  /**
   * Общая логика сопоставления операций с бюджетом — вынесена из
   * getBudgetStatus, чтобы использоваться и разбивкой по периодам
   * (getBudgetPeriodBreakdown), не дублируя правила сопоставления.
   */
  private async matchBudgetTransactions(
    familySpaceId: string,
    budget: { id: string; attributes: unknown },
  ): Promise<{ id: string; date: string; description: string; amount: number; category: string }[]> {
    const budgetAttrs = budget.attributes as Record<string, unknown>;
    const budgetCategoryId = budgetAttrs.categoryId as string | undefined;
    const budgetCategories = String(budgetAttrs.categories ?? '')
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    const startDate = String(budgetAttrs.startDate ?? '');
    const endDate = budgetAttrs.endDate ? String(budgetAttrs.endDate) : '9999-12-31';

    const transactions = await this.prisma.entity.findMany({
      where: { familySpaceId, entityType: 'financial_transaction', status: 'ACTIVE' },
      select: { id: true, attributes: true },
    });

    // Операция считается "по этому бюджету", если ЛИБО явно привязана
    // (attrs.budgetId === budgetId — приоритетный, точный способ, если
    // пользователь выставил его вручную), ЛИБО подходит по категории
    // (сперва пробуем categoryId из справочника, если у бюджета он указан;
    // иначе — старый текстовый способ через свободный список categories,
    // для операций, у которых ещё нет ссылки на справочник) и укладывается
    // в период бюджета.
    const matchedTransactions: { id: string; date: string; description: string; amount: number; category: string }[] = [];
    for (const tx of transactions) {
      const attrs = tx.attributes as Record<string, unknown>;
      if (!isActualTransaction(attrs)) continue; // плановые операции не входят в факт бюджета
      const amount = Number(attrs.amount) || 0;
      if (amount >= 0) continue; // расход — только отрицательные суммы

      const explicitlyLinked = attrs.budgetId === budget.id;
      if (!explicitlyLinked) {
        const date = String(attrs.date ?? '');
        const dateMatches = date && date >= startDate && date <= endDate;

        let categoryMatches: boolean;
        if (budgetCategoryId) {
          categoryMatches = attrs.categoryId === budgetCategoryId;
        } else {
          const category = String(attrs.category ?? '').toLowerCase();
          categoryMatches = budgetCategories.length === 0 || budgetCategories.includes(category);
        }
        if (!categoryMatches || !dateMatches) continue;
      }

      matchedTransactions.push({
        id: tx.id,
        date: String(attrs.date ?? ''),
        description: String(attrs.description ?? ''),
        amount,
        category: String(attrs.category ?? 'Без категории'),
      });
    }
    matchedTransactions.sort((a, b) => (a.date < b.date ? 1 : -1));
    return matchedTransactions;
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
    const matchedTransactions = await this.matchBudgetTransactions(familySpaceId, budget);
    const spent = matchedTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const planned = Number(budgetAttrs.plannedExpense) || 0;
    return {
      budgetId,
      budgetName: budget.title,
      plannedExpense: planned,
      spent: Math.round(spent * 100) / 100,
      remaining: Math.round((planned - spent) * 100) / 100,
      percentUsed: planned > 0 ? Math.round((spent / planned) * 1000) / 10 : null,
      matchedTransactions,
    };
  }

  /**
   * Разбивка бюджета по периодам (год/месяц/неделя) — пункт 5 запроса на
   * доработку: "возможность расписывать бюджеты по годам, месяцам,
   * неделям". Данные о распределении (`periodAllocations`) хранятся в
   * attributes бюджета и редактируются на фронтенде; здесь только считаем
   * факт по каждому периоду поверх той же логики сопоставления операций.
   */
  async getBudgetPeriodBreakdown(userId: string, familySpaceId: string, budgetId: string) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FINANCE', 'VIEW');

    const budget = await this.prisma.entity.findUnique({ where: { id: budgetId } });
    if (!budget || budget.familySpaceId !== familySpaceId || budget.entityType !== 'budget') {
      return null;
    }
    const budgetAttrs = budget.attributes as Record<string, unknown>;
    const periodType = (budgetAttrs.periodBreakdownType as BudgetPeriodType) || 'MONTHLY';
    const allocations = Array.isArray(budgetAttrs.periodAllocations)
      ? (budgetAttrs.periodAllocations as PeriodAllocation[])
      : [];

    const matchedTransactions = await this.matchBudgetTransactions(familySpaceId, budget);
    const periods = computePeriodBreakdown(allocations, periodType, matchedTransactions);

    return { budgetId, periodType, periods };
  }

  /**
   * Аналитика по участникам (владельцам счетов). Участник в Family OS —
   * это `Person` (профиль члена семьи), связанный со счётом через
   * `Entity.ownerPersonId` — тот же способ, что уже используется системно
   * для владения любыми записями (не изобретаем новое поле). Операция
   * "принадлежит" участнику через счёт, на котором она произошла.
   */
  async getAnalyticsByParticipant(
    userId: string,
    familySpaceId: string,
    startDate: string,
    endDate: string,
  ): Promise<ParticipantAnalytics[]> {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FINANCE', 'VIEW');

    const [accounts, persons, transactions] = await Promise.all([
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'bank_account' }, select: { id: true, ownerPersonId: true } }),
      this.prisma.person.findMany({ where: { familySpaceId, status: { not: 'VOID' } }, select: { id: true, fullName: true } }),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'financial_transaction', status: 'ACTIVE' }, select: { attributes: true } }),
    ]);

    const ownerByAccount = new Map<string, string | null>(
      accounts.map((a: { id: string; ownerPersonId: string | null }) => [a.id, a.ownerPersonId]),
    );
    const nameByPerson = new Map<string, string>(persons.map((p: { id: string; fullName: string }) => [p.id, p.fullName]));

    const byParticipant = new Map<string, { income: number; expense: number; count: number }>();
    for (const tx of transactions) {
      const attrs = tx.attributes as Record<string, unknown>;
      if (!isActualTransaction(attrs)) continue;
      const date = String(attrs.date ?? '');
      if (!date || date < startDate || date > endDate) continue;

      const accountId = attrs.accountId as string | undefined;
      const ownerPersonId: string | null | undefined = accountId ? ownerByAccount.get(accountId) : undefined;
      const key: string = ownerPersonId ?? 'unassigned';
      const amount = Number(attrs.amount) || 0;
      const entry = byParticipant.get(key) ?? { income: 0, expense: 0, count: 0 };
      if (amount >= 0) entry.income += amount;
      else entry.expense += Math.abs(amount);
      entry.count += 1;
      byParticipant.set(key, entry);
    }

    return Array.from(byParticipant.entries())
      .map(([key, data]) => ({
        personId: key === 'unassigned' ? null : key,
        personName: key === 'unassigned' ? 'Без владельца счёта' : (nameByPerson.get(key) ?? 'Неизвестный участник'),
        income: Math.round(data.income * 100) / 100,
        expense: Math.round(data.expense * 100) / 100,
        net: Math.round((data.income - data.expense) * 100) / 100,
        transactionCount: data.count,
      }))
      .sort((a, b) => b.expense - a.expense);
  }

  /**
   * Тепловая карта расходов по дням — возвращает КАЖДЫЙ день диапазона
   * (включая дни без трат — с expense: 0), чтобы фронтенд мог построить
   * непрерывную сетку без дырок.
   */
  async getSpendingHeatmap(userId: string, familySpaceId: string, startDate: string, endDate: string): Promise<HeatmapDay[]> {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FINANCE', 'VIEW');

    const transactions = await this.prisma.entity.findMany({
      where: { familySpaceId, entityType: 'financial_transaction', status: 'ACTIVE' },
      select: { attributes: true },
    });

    const byDate = new Map<string, number>();
    for (const tx of transactions) {
      const attrs = tx.attributes as Record<string, unknown>;
      if (!isActualTransaction(attrs)) continue;
      const amount = Number(attrs.amount) || 0;
      if (amount >= 0) continue;
      const date = String(attrs.date ?? '');
      if (!date || date < startDate || date > endDate) continue;
      byDate.set(date, (byDate.get(date) ?? 0) + Math.abs(amount));
    }

    const days: HeatmapDay[] = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    while (cursor.getTime() <= end.getTime()) {
      const iso = cursor.toISOString().slice(0, 10);
      days.push({ date: iso, expense: Math.round((byDate.get(iso) ?? 0) * 100) / 100 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }
}
