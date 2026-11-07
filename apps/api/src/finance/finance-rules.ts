/**
 * Правила автокатегоризации (Итерация 4) — по образцу Firefly III (rules:
 * triggers → actions) и Maybe (rules engine). Чистая логика без Prisma,
 * тестируется в изоляции (см. __tests__/finance-rules.spec.ts).
 *
 * Правило — это сущность `finance_rule` (общая таблица entities):
 *   - conditions: [{ field, op, value }]  — хранится в attributes как массив
 *     (общий валидатор не проверяет ключи вне схемы — как periodAllocations
 *     у бюджета);
 *   - matchMode: ALL (все условия) | ANY (любое);
 *   - действия: setCategoryId / setScope / setTransactionType / setCounterparty;
 *   - priority: меньше — раньше; stopProcessing: остановиться после
 *     сработавшего правила.
 *
 * Правила НЕ перезаписывают то, что пользователь уже указал руками: при
 * применении к существующим операциям по умолчанию заполняются только пустые
 * поля (onlyEmpty). Это продолжение принципа «автоматика не источник истины
 * без подтверждения пользователя» — плюс к старым операциям правила
 * применяются только после предпросмотра.
 */

export type RuleField = 'description' | 'counterparty' | 'mcc' | 'amount' | 'accountId' | 'bankCategory';
export type RuleOp = 'contains' | 'equals' | 'startsWith' | 'regex' | 'gt' | 'lt';

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  value: string;
}

export interface FinanceRule {
  id: string;
  name: string;
  isActive: boolean;
  priority: number;
  matchMode: 'ALL' | 'ANY';
  conditions: RuleCondition[];
  setCategoryId?: string;
  setScope?: 'PERSONAL' | 'FAMILY';
  setTransactionType?: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  setCounterparty?: string;
  stopProcessing?: boolean;
}

/** Минимальный набор полей операции, по которым работают правила. */
export interface RuleTransaction {
  description?: string;
  counterparty?: string;
  mcc?: string;
  amount?: number;
  accountId?: string;
  /** Текстовая категория из выписки (attributes.category). */
  category?: string;
  categoryId?: string;
  scope?: string;
  transactionType?: string;
}

export interface RuleChanges {
  categoryId?: string;
  scope?: 'PERSONAL' | 'FAMILY';
  transactionType?: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  counterparty?: string;
}

export interface RuleApplication {
  changes: RuleChanges;
  /** Сработавшие правила (по порядку) — показываются пользователю «почему так». */
  matchedRuleIds: string[];
  matchedRuleNames: string[];
}

const TEXT_OPS: RuleOp[] = ['contains', 'equals', 'startsWith', 'regex'];

function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Нормализует произвольный JSON из attributes в правило — мусор отбрасывается, а не роняет применение. */
export function normalizeRule(id: string, attrs: Record<string, unknown>): FinanceRule {
  const rawConditions = Array.isArray(attrs.conditions) ? attrs.conditions : [];
  const conditions: RuleCondition[] = rawConditions
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({ field: String(c.field) as RuleField, op: String(c.op) as RuleOp, value: String(c.value ?? '') }))
    .filter((c) => c.value.trim() !== '');
  return {
    id,
    name: String(attrs.name ?? 'Правило'),
    isActive: attrs.isActive !== false,
    priority: Number.isFinite(Number(attrs.priority)) ? Number(attrs.priority) : 100,
    matchMode: attrs.matchMode === 'ANY' ? 'ANY' : 'ALL',
    conditions,
    setCategoryId: (attrs.setCategoryId as string) || undefined,
    setScope: (attrs.setScope as FinanceRule['setScope']) || undefined,
    setTransactionType: (attrs.setTransactionType as FinanceRule['setTransactionType']) || undefined,
    setCounterparty: (attrs.setCounterparty as string) || undefined,
    stopProcessing: attrs.stopProcessing === true,
  };
}

/** Проверка корректности правила перед сохранением (для понятной ошибки в UI). */
export function validateRule(rule: Pick<FinanceRule, 'conditions' | 'setCategoryId' | 'setScope' | 'setTransactionType' | 'setCounterparty'>): string[] {
  const errors: string[] = [];
  if (rule.conditions.length === 0) errors.push('Нужно хотя бы одно условие');
  for (const c of rule.conditions) {
    if (c.field === 'amount') {
      if (!['equals', 'gt', 'lt'].includes(c.op)) errors.push('Для суммы доступны только «равно», «больше», «меньше»');
      if (!Number.isFinite(Number(c.value.replace(',', '.')))) errors.push(`«${c.value}» — не число`);
    } else if (!TEXT_OPS.includes(c.op)) {
      errors.push(`Оператор «${c.op}» не подходит для текстового поля`);
    }
    if (c.op === 'regex') {
      try {
        new RegExp(c.value, 'i');
      } catch {
        errors.push(`Некорректное регулярное выражение: ${c.value}`);
      }
    }
  }
  if (!rule.setCategoryId && !rule.setScope && !rule.setTransactionType && !rule.setCounterparty) {
    errors.push('Правило должно что-то менять — выберите хотя бы одно действие');
  }
  return errors;
}

function fieldValue(tx: RuleTransaction, field: RuleField): string | number | undefined {
  switch (field) {
    case 'description':
      return tx.description;
    case 'counterparty':
      return tx.counterparty;
    case 'mcc':
      return tx.mcc;
    case 'amount':
      return tx.amount;
    case 'accountId':
      return tx.accountId;
    case 'bankCategory':
      return tx.category;
  }
}

export function conditionMatches(tx: RuleTransaction, c: RuleCondition): boolean {
  const raw = fieldValue(tx, c.field);
  if (raw === undefined || raw === null || raw === '') return false;

  if (c.field === 'amount') {
    // Сравнение по модулю: пользователь пишет «больше 5000», имея в виду
    // трату на 5000+, а расходы у нас хранятся отрицательными.
    const amount = Math.abs(Number(raw));
    const target = Math.abs(Number(c.value.replace(',', '.')));
    if (!Number.isFinite(amount) || !Number.isFinite(target)) return false;
    if (c.op === 'gt') return amount > target;
    if (c.op === 'lt') return amount < target;
    if (c.op === 'equals') return Math.abs(amount - target) < 0.005;
    return false;
  }

  if (c.field === 'accountId') return String(raw) === c.value;

  const value = normalize(String(raw));
  const needle = normalize(c.value);
  switch (c.op) {
    case 'contains':
      return value.includes(needle);
    case 'equals':
      return value === needle;
    case 'startsWith':
      return value.startsWith(needle);
    case 'regex':
      try {
        return new RegExp(c.value, 'i').test(String(raw));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export function ruleMatches(tx: RuleTransaction, rule: FinanceRule): boolean {
  if (!rule.isActive || rule.conditions.length === 0) return false;
  return rule.matchMode === 'ANY'
    ? rule.conditions.some((c) => conditionMatches(tx, c))
    : rule.conditions.every((c) => conditionMatches(tx, c));
}

export function sortRules(rules: FinanceRule[]): FinanceRule[] {
  return rules.slice().sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

/**
 * Применяет правила к одной операции. Первое сработавшее правило «занимает»
 * поле — следующие его не перебивают (как в Firefly: порядок = приоритет).
 * onlyEmpty: не трогать поля, уже заполненные у операции.
 */
export function applyRules(tx: RuleTransaction, rules: FinanceRule[], opts: { onlyEmpty?: boolean } = {}): RuleApplication {
  const onlyEmpty = opts.onlyEmpty ?? true;
  const changes: RuleChanges = {};
  const matchedRuleIds: string[] = [];
  const matchedRuleNames: string[] = [];

  const canSet = (key: keyof RuleChanges, current: unknown) =>
    changes[key] === undefined && (!onlyEmpty || current === undefined || current === null || current === '');

  for (const rule of sortRules(rules)) {
    if (!ruleMatches(tx, rule)) continue;
    let changedSomething = false;
    if (rule.setCategoryId && canSet('categoryId', tx.categoryId)) {
      if (rule.setCategoryId !== tx.categoryId) changes.categoryId = rule.setCategoryId;
      changedSomething = true;
    }
    if (rule.setScope && canSet('scope', tx.scope)) {
      if (rule.setScope !== tx.scope) changes.scope = rule.setScope;
      changedSomething = true;
    }
    if (rule.setTransactionType && changes.transactionType === undefined && rule.setTransactionType !== tx.transactionType) {
      // Тип операции у импортированных всегда заполнен (EXPENSE/INCOME по знаку),
      // поэтому onlyEmpty к нему не применяется — иначе правило «это перевод»
      // никогда бы не срабатывало.
      changes.transactionType = rule.setTransactionType;
      changedSomething = true;
    }
    if (rule.setCounterparty && canSet('counterparty', tx.counterparty)) {
      if (rule.setCounterparty !== tx.counterparty) changes.counterparty = rule.setCounterparty;
      changedSomething = true;
    }
    if (changedSomething) {
      matchedRuleIds.push(rule.id);
      matchedRuleNames.push(rule.name);
    }
    if (rule.stopProcessing) break;
  }

  return { changes, matchedRuleIds, matchedRuleNames };
}

export function hasChanges(c: RuleChanges): boolean {
  return Object.values(c).some((v) => v !== undefined);
}

/**
 * Подсказка правила по операции («создать правило из операции»): берём
 * контрагента, если есть, иначе первые значимые слова описания без цифр
 * (номера карт/чеков в описании меняются от операции к операции).
 */
export function suggestConditionFromTransaction(tx: RuleTransaction): RuleCondition | null {
  if (tx.counterparty && tx.counterparty.trim().length >= 3) {
    return { field: 'counterparty', op: 'contains', value: tx.counterparty.trim() };
  }
  const words = (tx.description ?? '')
    .replace(/[0-9*#№]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\-.]/gu, ''))
    .filter((w) => w.length >= 3);
  if (words.length === 0) return null;
  return { field: 'description', op: 'contains', value: words.slice(0, 2).join(' ') };
}
