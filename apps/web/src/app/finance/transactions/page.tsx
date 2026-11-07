'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { FinanceSubNav } from '@/components/finance-subnav';
import EntityLinkSelect from '@/components/ui/entity-link-select';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Badge } from '@/components/ui';
import { toast } from 'sonner';
import { Plus, Pencil, ArrowUpRight, ArrowDownLeft, CalendarClock, Archive, Download, ArrowLeftRight, Eraser } from 'lucide-react';

interface TransactionEntity {
  id: string;
  title: string;
  status: string;
  attributes: {
    date: string;
    amount: number;
    currency: string;
    description?: string;
    category?: string;
    categoryId?: string;
    accountId: string;
    scope?: string;
    transactionType?: string;
    isPlanned?: boolean;
    plannedStatus?: 'PLANNED' | 'COMPLETED' | 'CANCELLED';
  };
}

interface AccountEntity {
  id: string;
  title: string;
  status?: string;
  attributes: { currency?: string; bankName?: string };
}

interface CategoryEntity {
  id: string;
  title: string;
}

interface FormState {
  date: string;
  amount: string;
  accountId: string;
  categoryId: string;
  description: string;
  scope: string;
  isPlanned: boolean;
}

const EMPTY_FORM: FormState = { date: '', amount: '', accountId: '', categoryId: '', description: '', scope: 'FAMILY', isPlanned: false };

export default function TransactionsPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const [transactions, setTransactions] = useState<TransactionEntity[]>([]);
  const [accounts, setAccounts] = useState<AccountEntity[]>([]);
  const [categories, setCategories] = useState<CategoryEntity[]>([]);
  const [error, setError] = useState('');

  // Фильтры — по образцу famfi.app: поиск, тип, категория, счёт, диапазон дат.
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Как на странице «Счета»: архивные счета и их операции скрыты по умолчанию.
  const [showArchived, setShowArchived] = useState(false);

  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Перевод между своими счетами — отдельная мини-форма: две ссылки на
  // счета (откуда/куда) вместо одной, создаёт сразу пару связанных
  // операций (расход на одном счёте + доход на другом).
  const [transferMode, setTransferMode] = useState(false);
  const [transferForm, setTransferForm] = useState({ date: '', amount: '', fromAccountId: '', toAccountId: '', description: 'Между своими счетами' });
  const [transferSaving, setTransferSaving] = useState(false);

  async function load() {
    const [txs, accs, cats] = await Promise.all([
      apiFetch<TransactionEntity[]>('/entities?entityType=financial_transaction'),
      apiFetch<AccountEntity[]>('/entities?entityType=bank_account'),
      apiFetch<CategoryEntity[]>('/entities?entityType=financial_category'),
    ]);
    setTransactions(txs);
    setAccounts(accs);
    setCategories(cats);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const accountById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);
  const activeAccounts = useMemo(() => accounts.filter((a) => a.status !== 'ARCHIVED'), [accounts]);
  const filterAccounts = showArchived ? accounts : activeAccounts;
  const categoryById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.title])), [categories]);

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      const a = t.attributes;
      if (!showArchived && (t.status === 'ARCHIVED' || accountById[a.accountId]?.status === 'ARCHIVED')) return false;
      if (search && !(a.description ?? '').toLowerCase().includes(search.toLowerCase())) return false;
      if (typeFilter === 'EXPENSE' && a.amount >= 0) return false;
      if (typeFilter === 'INCOME' && a.amount < 0) return false;
      if (categoryFilter && a.categoryId !== categoryFilter) return false;
      if (accountFilter && a.accountId !== accountFilter) return false;
      if (dateFrom && a.date < dateFrom) return false;
      if (dateTo && a.date > dateTo) return false;
      return true;
    });
  }, [transactions, search, typeFilter, categoryFilter, accountFilter, dateFrom, dateTo, showArchived, accountById]);

  const groupedByMonth = useMemo(() => {
    const groups = new Map<string, TransactionEntity[]>();
    for (const t of filtered.slice().sort((a, b) => (a.attributes.date < b.attributes.date ? 1 : -1))) {
      const key = t.attributes.date?.slice(0, 7) || 'без даты';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  function openNew() {
    setForm({ ...EMPTY_FORM, date: new Date().toISOString().slice(0, 10), accountId: accounts[0]?.id ?? '' });
    setEditingId('new');
  }

  function openEdit(t: TransactionEntity) {
    setForm({
      date: t.attributes.date,
      amount: String(t.attributes.amount),
      accountId: t.attributes.accountId,
      categoryId: t.attributes.categoryId ?? '',
      description: t.attributes.description ?? '',
      scope: t.attributes.scope ?? 'FAMILY',
      isPlanned: t.attributes.isPlanned === true,
    });
    setEditingId(t.id);
  }

  async function onSave() {
    const amount = Number(form.amount);
    if (!form.date || Number.isNaN(amount) || !form.accountId) {
      toast.error('Укажите дату, счёт и корректную сумму');
      return;
    }
    setSaving(true);
    try {
      const account = accountById[form.accountId];
      const attributes = {
        date: form.date,
        amount,
        currency: account?.attributes.currency ?? 'RUB',
        accountId: form.accountId,
        description: form.description || (amount < 0 ? 'Расход' : 'Доход'),
        categoryId: form.categoryId || undefined,
        category: form.categoryId ? categoryById[form.categoryId] : undefined,
        scope: form.scope || undefined,
        transactionType: amount < 0 ? 'EXPENSE' : 'INCOME',
        source: 'MANUAL',
        isPlanned: form.isPlanned,
        plannedStatus: form.isPlanned ? 'PLANNED' : undefined,
      };
      if (editingId === 'new') {
        await apiFetch('/entities', {
          method: 'POST',
          body: { entityType: 'financial_transaction', title: `${form.date}: ${attributes.description}`, attributes },
        });
        toast.success('Операция добавлена');
      } else if (editingId) {
        await apiFetch(`/entities/${editingId}`, { method: 'PATCH', body: { attributes } });
        toast.success('Операция сохранена');
      }
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось сохранить операцию');
    } finally {
      setSaving(false);
    }
  }

  async function onMarkCompleted(t: TransactionEntity) {
    try {
      await apiFetch(`/entities/${t.id}`, { method: 'PATCH', body: { attributes: { plannedStatus: 'COMPLETED' } } });
      toast.success('Отмечено как совершённая операция');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось обновить статус');
    }
  }

  async function onArchive(t: TransactionEntity) {
    try {
      await apiFetch(`/entities/${t.id}/archive`, { method: 'PATCH' });
      toast.success('Операция архивирована');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось архивировать операцию');
    }
  }

  function openTransfer() {
    setTransferForm({
      date: new Date().toISOString().slice(0, 10),
      amount: '',
      fromAccountId: accounts[0]?.id ?? '',
      toAccountId: accounts[1]?.id ?? accounts[0]?.id ?? '',
      description: 'Между своими счетами',
    });
    setTransferMode(true);
  }

  async function onSaveTransfer() {
    const amount = Math.abs(Number(transferForm.amount));
    if (!transferForm.date || !amount || !transferForm.fromAccountId || !transferForm.toAccountId) {
      toast.error('Укажите дату, сумму и оба счёта');
      return;
    }
    if (transferForm.fromAccountId === transferForm.toAccountId) {
      toast.error('Счёт списания и счёт зачисления должны отличаться');
      return;
    }
    setTransferSaving(true);
    try {
      const fromAccount = accountById[transferForm.fromAccountId];
      const toAccount = accountById[transferForm.toAccountId];
      const outgoing = await apiFetch<TransactionEntity>('/entities', {
        method: 'POST',
        body: {
          entityType: 'financial_transaction',
          title: `${transferForm.date}: ${transferForm.description}`,
          attributes: {
            date: transferForm.date,
            amount: -amount,
            currency: fromAccount?.attributes.currency ?? 'RUB',
            accountId: transferForm.fromAccountId,
            description: transferForm.description || 'Между своими счетами',
            category: 'Между своими счетами',
            transactionType: 'TRANSFER',
            source: 'MANUAL',
          },
        },
      });
      const incoming = await apiFetch<TransactionEntity>('/entities', {
        method: 'POST',
        body: {
          entityType: 'financial_transaction',
          title: `${transferForm.date}: ${transferForm.description}`,
          attributes: {
            date: transferForm.date,
            amount,
            currency: toAccount?.attributes.currency ?? 'RUB',
            accountId: transferForm.toAccountId,
            description: transferForm.description || 'Между своими счетами',
            category: 'Между своими счетами',
            transactionType: 'TRANSFER',
            source: 'MANUAL',
          },
        },
      });
      // Связываем пару операций перевода взаимной ссылкой — та же схема,
      // что и для переводов, автоматически распознанных при импорте выписки.
      await apiFetch(`/entities/${outgoing.id}`, { method: 'PATCH', body: { attributes: { relatedTransactionId: incoming.id } } });
      await apiFetch(`/entities/${incoming.id}`, { method: 'PATCH', body: { attributes: { relatedTransactionId: outgoing.id } } });
      toast.success('Перевод между счетами добавлен');
      setTransferMode(false);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось сохранить перевод');
    } finally {
      setTransferSaving(false);
    }
  }

  function onExportCsv() {
    const header = ['Дата', 'Категория', 'Описание', 'Счёт', 'Сумма', 'Валюта', 'Плановая'];
    const rows = filtered
      .slice()
      .sort((a, b) => (a.attributes.date < b.attributes.date ? 1 : -1))
      .map((t) => [
        t.attributes.date,
        (t.attributes.categoryId ? categoryById[t.attributes.categoryId] : t.attributes.category) ?? '',
        t.attributes.description ?? '',
        accountById[t.attributes.accountId]?.title ?? '',
        String(t.attributes.amount),
        t.attributes.currency,
        t.attributes.isPlanned ? 'да' : 'нет',
      ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `транзакции_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Транзакции</h1>
          <p className="mt-1 text-sm text-ink/60">Все операции по всем счетам в одном месте.</p>
        </div>
        <Button onClick={openNew} disabled={activeAccounts.length === 0}>
          <Plus size={16} /> Добавить
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Link href="/finance/cleanup" className="inline-flex items-center gap-2 rounded-card px-4 py-2 text-sm font-medium text-ink/70 hover:bg-paper-dim">
          <Eraser size={16} /> Очистка тестовых
        </Link>
        <Button variant="secondary" onClick={openTransfer} disabled={activeAccounts.length < 2}>
          <ArrowLeftRight size={16} /> Перевод между счетами
        </Button>
        <Button variant="secondary" onClick={onExportCsv} disabled={filtered.length === 0}>
          <Download size={16} /> Экспорт в CSV
        </Button>
      </div>

      <div className="mt-4">
        <FinanceSubNav active="/finance/transactions" />
      </div>

      <ErrorText>{error}</ErrorText>

      <Card className="mt-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск…"
            className="rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-card border border-line bg-paper px-3 py-1.5 text-sm">
            <option value="">Все типы</option>
            <option value="EXPENSE">Расходы</option>
            <option value="INCOME">Доходы</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
          >
            <option value="">Все категории</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
          >
            <option value="">Все счета</option>
            {filterAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
                {a.status === 'ARCHIVED' ? ' (архив)' : ''}
              </option>
            ))}
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-card border border-line bg-paper px-3 py-1.5 text-sm" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-card border border-line bg-paper px-3 py-1.5 text-sm" />
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm text-ink/60">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 rounded border-line" />
          Показать архивные счета и операции
        </label>
      </Card>

      {transferMode && (
        <Card className="animate-in mt-4">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <ArrowLeftRight size={18} className="text-ink/40" /> Перевод между счетами
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-ink/50">Дата</label>
              <input
                type="date"
                value={transferForm.date}
                onChange={(e) => setTransferForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink/50">Сумма перевода</label>
              <input
                type="number"
                step="0.01"
                value={transferForm.amount}
                onChange={(e) => setTransferForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink/50">Со счёта</label>
              <select
                value={transferForm.fromAccountId}
                onChange={(e) => setTransferForm((f) => ({ ...f, fromAccountId: e.target.value }))}
                className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              >
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink/50">На счёт</label>
              <select
                value={transferForm.toAccountId}
                onChange={(e) => setTransferForm((f) => ({ ...f, toAccountId: e.target.value }))}
                className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              >
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-ink/50">Описание</label>
              <input
                value={transferForm.description}
                onChange={(e) => setTransferForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-ink/50">
            Создаст две связанные операции: расход на счёте списания и доход на счёте зачисления.
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={onSaveTransfer} disabled={transferSaving}>
              {transferSaving ? 'Сохраняем…' : 'Сохранить перевод'}
            </Button>
            <Button variant="secondary" onClick={() => setTransferMode(false)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}

      {editingId && (
        <Card className="animate-in mt-4">
          <h2 className="font-display text-lg font-semibold">{editingId === 'new' ? 'Новая операция' : 'Редактирование операции'}</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-ink/50">Счёт</label>
              <select
                value={form.accountId}
                onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              >
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink/50">Дата</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink/50">Сумма (отрицательная — расход)</label>
              <input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink/50">Категория</label>
              <EntityLinkSelect
                entityType="financial_category"
                value={form.categoryId || undefined}
                onChange={(id) => setForm((f) => ({ ...f, categoryId: id ?? '' }))}
                placeholder="Начните ввод для поиска категории…"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink/50">Описание</label>
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink/50">Тип расхода</label>
              <select
                value={form.scope}
                onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
                className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              >
                <option value="FAMILY">Семейный</option>
                <option value="PERSONAL">Личный</option>
              </select>
            </div>
            <label className="flex items-center gap-2 pt-6 text-sm text-ink/80">
              <input
                type="checkbox"
                checked={form.isPlanned}
                onChange={(e) => setForm((f) => ({ ...f, isPlanned: e.target.checked }))}
                className="h-4 w-4 rounded border-line"
              />
              <CalendarClock size={14} className="text-ink/40" />
              Плановая операция
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={onSave} disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            <Button variant="secondary" onClick={() => setEditingId(null)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}

      <div className="mt-4 space-y-6">
        {groupedByMonth.map(([month, txs]) => (
          <Card key={month}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/40">{formatMonth(month)}</h3>
            <div className="divide-y divide-line">
              {txs.map((t) => {
                const account = accountById[t.attributes.accountId];
                const categoryName = t.attributes.categoryId ? categoryById[t.attributes.categoryId] : t.attributes.category;
                const isPending = t.attributes.isPlanned && (t.attributes.plannedStatus ?? 'PLANNED') === 'PLANNED';
                return (
                  <div key={t.id} className="group flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      {t.attributes.amount < 0 ? (
                        <ArrowUpRight size={14} className="shrink-0 text-clay" />
                      ) : (
                        <ArrowDownLeft size={14} className="shrink-0 text-moss-600" />
                      )}
                      <div>
                        <p className="flex items-center gap-1.5 text-ink">
                          {t.attributes.description}
                          {isPending && <Badge tone="gold">план</Badge>}
                          {t.status === 'ARCHIVED' && <Badge tone="default">архив</Badge>}
                        </p>
                        <p className="text-xs text-ink/40">
                          {t.attributes.date} {categoryName && `· ${categoryName}`} {account && <>· <span className="font-semibold text-ink/80">{account.title}</span></>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className={t.attributes.amount < 0 ? 'text-clay' : 'text-moss-600'}>
                        {t.attributes.amount > 0 ? '+' : ''}
                        {t.attributes.amount} {t.attributes.currency}
                      </p>
                      {isPending && (
                        <button
                          onClick={() => onMarkCompleted(t)}
                          title="Отметить как совершённую"
                          className="rounded-card px-2 py-1 text-xs text-moss-600 opacity-0 hover:bg-paper-dim group-hover:opacity-100"
                        >
                          Совершена
                        </button>
                      )}
                      <button onClick={() => openEdit(t)} title="Редактировать" className="opacity-0 hover:text-clay group-hover:opacity-100">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => onArchive(t)} title="Архивировать" className="opacity-0 hover:text-clay group-hover:opacity-100">
                        <Archive size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
        {groupedByMonth.length === 0 && <p className="text-sm text-ink/50">Операций по заданным фильтрам не найдено.</p>}
      </div>
    </AppShell>
  );
}

function formatMonth(key: string): string {
  if (key === 'без даты') return key;
  const [y, m] = key.split('-');
  const months = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  return `${months[Number(m) - 1] ?? m} ${y}`;
}
