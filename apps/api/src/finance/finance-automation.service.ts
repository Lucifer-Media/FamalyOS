import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { AuditService } from '../audit/audit.service';
import { EntitiesService } from '../entities/entities.service';
import { isActualTransaction } from './finance-analytics.service';
import { applyRules, normalizeRule, validateRule, hasChanges, FinanceRule, RuleCondition, RuleTransaction } from './finance-rules';
import { detectRecurring, computeNeedsStatus, RecurringTx, NeedInput } from './recurring-detection';
import { computeGoalProgress, GoalProgress } from './goal-progress';

type Attrs = Record<string, unknown>;

export interface TxRow {
  id: string;
  attributes: Attrs;
}

export function toRuleTx(a: Attrs): RuleTransaction {
  return {
    description: a.description as string | undefined,
    counterparty: a.counterparty as string | undefined,
    mcc: a.mcc as string | undefined,
    amount: Number(a.amount),
    accountId: a.accountId as string | undefined,
    category: a.category as string | undefined,
    categoryId: a.categoryId as string | undefined,
    scope: a.scope as string | undefined,
    transactionType: a.transactionType as string | undefined,
  };
}

export function toRecurringTx(t: TxRow): RecurringTx {
  const a = t.attributes;
  return {
    id: t.id,
    date: String(a.date ?? ''),
    amount: Number(a.amount) || 0,
    description: a.description as string | undefined,
    counterparty: a.counterparty as string | undefined,
    categoryId: a.categoryId as string | undefined,
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Итерация 4 — автоматизация финансов: правила, подписки/регулярные
 * платежи, копилки, массовая очистка (архивирование) тестовых операций.
 *
 * Все изменения данных идут через EntitiesService (update/create/setStatus) —
 * значит, автоматически работают права (FINANCE), версии записи и журнал
 * аудита, как у любой другой правки. Физического удаления нет.
 */
@Injectable()
export class FinanceAutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly entities: EntitiesService,
  ) {}

  private async assert(userId: string, familySpaceId: string, action: 'VIEW' | 'EDIT' | 'CREATE' | 'ARCHIVE') {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FINANCE', action);
    return membership;
  }

  async loadActiveTransactions(familySpaceId: string): Promise<TxRow[]> {
    const rows = await this.prisma.entity.findMany({
      where: { familySpaceId, entityType: 'financial_transaction', status: 'ACTIVE' },
      select: { id: true, attributes: true },
    });
    return (rows as { id: string; attributes: unknown }[]).map((r) => ({ id: r.id, attributes: (r.attributes ?? {}) as Attrs }));
  }

  // ---------- Правила ----------

  async loadRules(familySpaceId: string): Promise<FinanceRule[]> {
    const rows = await this.prisma.entity.findMany({
      where: { familySpaceId, entityType: 'finance_rule', status: 'ACTIVE' },
      select: { id: true, attributes: true },
    });
    return (rows as { id: string; attributes: unknown }[]).map((r) => normalizeRule(r.id, (r.attributes ?? {}) as Attrs));
  }

  /** Создание/изменение правила с проверкой условий (общий /entities не знает про conditions). */
  async saveRule(userId: string, familySpaceId: string, dto: { id?: string; attributes: Attrs }) {
    const normalized = normalizeRule(dto.id ?? 'new', dto.attributes);
    const errors = validateRule(normalized);
    if (errors.length) throw new BadRequestException({ message: 'Правило заполнено не полностью', errors });
    const attributes: Attrs = {
      ...dto.attributes,
      name: normalized.name,
      isActive: normalized.isActive,
      priority: normalized.priority,
      matchMode: normalized.matchMode,
      conditions: normalized.conditions,
    };
    if (dto.id) {
      return this.entities.update(userId, familySpaceId, dto.id, { title: normalized.name, attributes, changeSummary: 'Изменение правила' });
    }
    return this.entities.create(userId, familySpaceId, {
      entityType: 'finance_rule',
      title: normalized.name,
      attributes: { source: 'MANUAL', ...attributes },
      changeSummary: 'Создание правила автокатегоризации',
    });
  }

  /**
   * Предпросмотр/применение правил к уже существующим операциям.
   * dryRun=true — ничего не меняет, возвращает список «что изменится».
   * ruleIds — применить только эти правила (иначе все активные);
   * draftRule — проверить ещё не сохранённое правило (предпросмотр в редакторе).
   */
  async applyRulesToExisting(
    userId: string,
    familySpaceId: string,
    dto: { dryRun?: boolean; ruleIds?: string[]; onlyEmpty?: boolean; draftRule?: Attrs; limit?: number },
  ) {
    await this.assert(userId, familySpaceId, dto.dryRun === false ? 'EDIT' : 'VIEW');
    let rules = dto.draftRule ? [normalizeRule('draft', dto.draftRule)] : await this.loadRules(familySpaceId);
    if (dto.ruleIds?.length) rules = rules.filter((r) => dto.ruleIds!.includes(r.id));
    const transactions = await this.loadActiveTransactions(familySpaceId);

    const changes: { transactionId: string; date: string; description: string; amount: number; changes: Attrs; rules: string[] }[] = [];
    for (const tx of transactions) {
      const res = applyRules(toRuleTx(tx.attributes), rules, { onlyEmpty: dto.onlyEmpty ?? true });
      if (!hasChanges(res.changes)) continue;
      changes.push({
        transactionId: tx.id,
        date: String(tx.attributes.date ?? ''),
        description: String(tx.attributes.description ?? ''),
        amount: Number(tx.attributes.amount) || 0,
        changes: res.changes as Attrs,
        rules: res.matchedRuleNames,
      });
    }
    changes.sort((a, b) => (a.date < b.date ? 1 : -1));

    if (dto.dryRun !== false) return { dryRun: true, total: changes.length, items: changes.slice(0, dto.limit ?? 300) };

    let applied = 0;
    for (const c of changes) {
      await this.entities.update(userId, familySpaceId, c.transactionId, {
        attributes: c.changes,
        changeSummary: `Правило: ${c.rules.join(', ')}`,
      });
      applied++;
    }
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'finance.rules_applied',
      resourceType: 'finance_rule',
      metadata: { applied, ruleIds: dto.ruleIds ?? 'all' },
    });
    return { dryRun: false, total: applied, items: [] };
  }

  // ---------- Регулярные платежи / подписки ----------

  async getRecurringCandidates(userId: string, familySpaceId: string) {
    await this.assert(userId, familySpaceId, 'VIEW');
    const [txs, needs] = await Promise.all([
      this.loadActiveTransactions(familySpaceId),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'financial_need', status: 'ACTIVE' }, select: { attributes: true } }),
    ]);
    const trackedPatterns = (needs as { attributes: unknown }[]).flatMap((n) => {
      const a = (n.attributes ?? {}) as Attrs;
      return [a.matchPattern, a.name].filter((x): x is string => typeof x === 'string' && x.length > 0);
    });
    return detectRecurring(
      txs.filter((t) => isActualTransaction(t.attributes) && t.attributes.transactionType !== 'TRANSFER').map(toRecurringTx),
      { today: todayIso(), trackedPatterns },
    );
  }

  async getNeedsStatus(userId: string, familySpaceId: string, month?: string) {
    await this.assert(userId, familySpaceId, 'VIEW');
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : todayIso().slice(0, 7);
    const [txs, needRows] = await Promise.all([
      this.loadActiveTransactions(familySpaceId),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'financial_need', status: 'ACTIVE' }, select: { id: true, attributes: true } }),
    ]);
    const needs: NeedInput[] = (needRows as { id: string; attributes: unknown }[]).map((n) => {
      const a = (n.attributes ?? {}) as Attrs;
      return {
        id: n.id,
        name: String(a.name ?? 'Платёж'),
        amount: Number(a.amountMonthly) || 0,
        currency: a.currency as string | undefined,
        categoryId: a.categoryId as string | undefined,
        matchPattern: a.matchPattern as string | undefined,
        dueDay: a.dueDay !== undefined ? Number(a.dueDay) : undefined,
        nextDueDate: a.nextDueDate as string | undefined,
        priority: a.priority as string | undefined,
      };
    });
    const items = computeNeedsStatus(
      needs,
      txs.filter((t) => isActualTransaction(t.attributes)).map(toRecurringTx),
      m,
      todayIso(),
    );
    return {
      month: m,
      planned: round2(items.reduce((s, i) => s + i.plannedAmount, 0)),
      paid: round2(items.reduce((s, i) => s + i.paidAmount, 0)),
      overdueCount: items.filter((i) => i.status === 'OVERDUE').length,
      items,
    };
  }

  /** «Сделать обязательным платежом» из найденного кандидата. */
  async createNeedFromCandidate(
    userId: string,
    familySpaceId: string,
    dto: { name: string; amount: number; currency?: string; matchPattern: string; period: string; categoryId?: string; nextDueDate?: string; isSubscription?: boolean },
  ) {
    if (!dto.name || !(dto.amount > 0) || !dto.matchPattern) throw new BadRequestException('Нужны название, сумма и текст для поиска');
    const dueDay = dto.nextDueDate ? Number(dto.nextDueDate.slice(8, 10)) : undefined;
    return this.entities.create(userId, familySpaceId, {
      entityType: 'financial_need',
      title: dto.name,
      attributes: {
        name: dto.name,
        amountMonthly: Math.round(dto.amount * 100) / 100,
        currency: dto.currency ?? 'RUB',
        categoryId: dto.categoryId || undefined,
        isRecurring: true,
        recurringPeriod: ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'].includes(dto.period) ? dto.period : 'MONTHLY',
        nextDueDate: dto.nextDueDate || undefined,
        dueDay: dto.period === 'MONTHLY' ? dueDay : undefined,
        matchPattern: dto.matchPattern,
        isSubscription: dto.isSubscription ?? false,
        priority: 'IMPORTANT',
      },
      changeSummary: 'Создано из найденного регулярного платежа',
    });
  }

  // ---------- Копилки ----------

  async getGoalsSummary(userId: string, familySpaceId: string): Promise<(GoalProgress & { currency: string; deadline?: string; icon?: string; status: string; entityStatus: string })[]> {
    await this.assert(userId, familySpaceId, 'VIEW');
    const [goals, contributions, accounts] = await Promise.all([
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'financial_goal', status: { in: ['ACTIVE', 'ARCHIVED'] } }, select: { id: true, status: true, attributes: true } }),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'financial_goal_contribution', status: 'ACTIVE' }, select: { attributes: true } }),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'bank_account' }, select: { id: true, attributes: true } }),
    ]);
    const balanceByAccount = new Map(
      (accounts as { id: string; attributes: unknown }[]).map((a) => [a.id, Number(((a.attributes ?? {}) as Attrs).currentBalance) || 0]),
    );
    const byGoal = new Map<string, { date: string; amount: number }[]>();
    for (const c of contributions as { attributes: unknown }[]) {
      const a = (c.attributes ?? {}) as Attrs;
      const goalId = String(a.goalId ?? '');
      if (!byGoal.has(goalId)) byGoal.set(goalId, []);
      byGoal.get(goalId)!.push({ date: String(a.date ?? ''), amount: Number(a.amount) || 0 });
    }
    const today = todayIso();
    return (goals as { id: string; status: string; attributes: unknown }[]).map((g) => {
      const a = (g.attributes ?? {}) as Attrs;
      const progress = computeGoalProgress(
        {
          id: g.id,
          name: String(a.name ?? 'Цель'),
          targetAmount: Number(a.targetAmount) || 0,
          deadline: a.deadline as string | undefined,
          startAmount: Number(a.startAmount) || 0,
          trackingMode: a.trackingMode === 'ACCOUNT_BALANCE' ? 'ACCOUNT_BALANCE' : 'CONTRIBUTIONS',
          accountBalance: a.savingsAccountId ? balanceByAccount.get(String(a.savingsAccountId)) : undefined,
        },
        byGoal.get(g.id) ?? [],
        today,
      );
      return {
        ...progress,
        currency: String(a.currency ?? 'RUB'),
        deadline: a.deadline as string | undefined,
        icon: a.icon as string | undefined,
        status: String(a.status ?? 'ACTIVE'),
        entityStatus: g.status,
      };
    });
  }

  async addContribution(userId: string, familySpaceId: string, goalId: string, dto: { amount: number; date?: string; accountId?: string; note?: string }) {
    const goal = await this.prisma.entity.findUnique({ where: { id: goalId } });
    if (!goal || goal.familySpaceId !== familySpaceId || goal.entityType !== 'financial_goal') throw new NotFoundException('Копилка не найдена');
    if (!Number.isFinite(dto.amount) || dto.amount === 0) throw new BadRequestException('Сумма пополнения не может быть нулевой');
    const a = (goal.attributes ?? {}) as Attrs;
    return this.entities.create(userId, familySpaceId, {
      entityType: 'financial_goal_contribution',
      title: `${dto.amount > 0 ? 'Пополнение' : 'Изъятие'}: ${String(a.name ?? goal.title)}`,
      attributes: {
        goalId,
        date: dto.date || todayIso(),
        amount: Math.round(dto.amount * 100) / 100,
        currency: String(a.currency ?? 'RUB'),
        accountId: dto.accountId || undefined,
        note: dto.note || undefined,
      },
      changeSummary: dto.amount > 0 ? 'Пополнение копилки' : 'Изъятие из копилки',
    });
  }

  async listContributions(userId: string, familySpaceId: string, goalId: string) {
    await this.assert(userId, familySpaceId, 'VIEW');
    const rows = await this.prisma.entity.findMany({
      where: { familySpaceId, entityType: 'financial_goal_contribution', status: 'ACTIVE' },
      select: { id: true, attributes: true, createdAt: true },
    });
    return (rows as { id: string; attributes: unknown }[])
      .map((r) => ({ id: r.id, ...((r.attributes ?? {}) as Attrs) }))
      .filter((r) => (r as Attrs).goalId === goalId)
      .sort((a, b) => (String((a as Attrs).date) < String((b as Attrs).date) ? 1 : -1));
  }

  // ---------- Очистка тестовых операций (архивирование) ----------

  private filterForCleanup(txs: TxRow[], f: CleanupFilter): TxRow[] {
    return txs.filter((t) => {
      const a = t.attributes;
      if (f.accountId && a.accountId !== f.accountId) return false;
      if (f.source && a.source !== f.source) return false;
      if (f.dateFrom && String(a.date ?? '') < f.dateFrom) return false;
      if (f.dateTo && String(a.date ?? '') > f.dateTo) return false;
      return true;
    });
  }

  async cleanupPreview(userId: string, familySpaceId: string, f: CleanupFilter) {
    await this.assert(userId, familySpaceId, 'VIEW');
    if (!f.all && !f.accountId && !f.source && !f.dateFrom && !f.dateTo) {
      throw new BadRequestException('Укажите фильтр или явно выберите «все операции»');
    }
    const matched = this.filterForCleanup(await this.loadActiveTransactions(familySpaceId), f);
    const byAccount = new Map<string, number>();
    for (const t of matched) byAccount.set(String(t.attributes.accountId ?? ''), (byAccount.get(String(t.attributes.accountId ?? '')) ?? 0) + 1);
    const dates = matched.map((t) => String(t.attributes.date ?? '')).filter(Boolean).sort();
    return {
      count: matched.length,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      byAccount: [...byAccount.entries()].map(([accountId, count]) => ({ accountId, count })),
      sample: matched.slice(0, 20).map((t) => ({ id: t.id, date: t.attributes.date, amount: t.attributes.amount, description: t.attributes.description })),
    };
  }

  /**
   * Архивирует операции по фильтру. Архивные операции не попадают ни в
   * аналитику, ни в бюджеты, ни в отчёты (везде фильтр status=ACTIVE) и
   * восстанавливаются через карточку записи. Ключи дедупликации импорта
   * перестают блокировать повторный импорт тех же строк выписки — см.
   * FinanceImportService (проверка статуса связанной операции).
   */
  async cleanupArchive(userId: string, familySpaceId: string, f: CleanupFilter & { confirmCount: number }) {
    await this.assert(userId, familySpaceId, 'ARCHIVE');
    const preview = await this.cleanupPreview(userId, familySpaceId, f);
    if (preview.count !== f.confirmCount) {
      throw new BadRequestException(`Набор операций изменился (сейчас ${preview.count}, подтверждено ${f.confirmCount}) — обновите предпросмотр`);
    }
    const matched = this.filterForCleanup(await this.loadActiveTransactions(familySpaceId), f);
    let archived = 0;
    for (const t of matched) {
      await this.entities.setStatus(userId, familySpaceId, t.id, 'ARCHIVED', 'Очистка тестовых операций');
      archived++;
    }
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'finance.cleanup_archived',
      resourceType: 'financial_transaction',
      metadata: { archived, filter: { ...f, confirmCount: undefined } },
    });
    return { archived };
  }
}

export interface CleanupFilter {
  all?: boolean;
  accountId?: string;
  source?: 'IMPORT' | 'MANUAL';
  dateFrom?: string;
  dateTo?: string;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export type { RuleCondition };
