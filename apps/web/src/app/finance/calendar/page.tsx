'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { FinanceSubNav } from '@/components/finance-subnav';
import EntityLinkSelect from '@/components/ui/entity-link-select';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Badge } from '@/components/ui';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Plus, CheckCircle2, Archive } from 'lucide-react';

interface TransactionEntity {
  id: string;
  status: string;
  attributes: {
    date: string;
    amount: number;
    currency: string;
    description?: string;
    categoryId?: string;
    category?: string;
    accountId: string;
    isPlanned?: boolean;
    plannedStatus?: 'PLANNED' | 'COMPLETED' | 'CANCELLED';
  };
}

interface AccountEntity {
  id: string;
  title: string;
  attributes: { currency?: string; currentBalance?: number };
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function isActual(a: TransactionEntity['attributes']): boolean {
  if (a.isPlanned !== true) return true;
  return a.plannedStatus === 'COMPLETED';
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export default function FinanceCalendarPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() }; // month: 0-11
  });
  const [tab, setTab] = useState<'calendar' | 'planned'>('calendar');
  const [transactions, setTransactions] = useState<TransactionEntity[]>([]);
  const [accounts, setAccounts] = useState<AccountEntity[]>([]);
  const [error, setError] = useState('');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ date: '', amount: '', accountId: '', categoryId: '', description: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    const [txs, accs] = await Promise.all([
      apiFetch<TransactionEntity[]>('/entities?entityType=financial_transaction'),
      apiFetch<AccountEntity[]>('/entities?entityType=bank_account&status=ACTIVE'),
    ]);
    setTransactions(txs);
    setAccounts(accs);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const todayIso = new Date().toISOString().slice(0, 10);
  const monthPrefix = `${cursor.year}-${pad(cursor.month + 1)}`;

  const monthTransactions = useMemo(
    () => transactions.filter((t) => t.attributes.date?.startsWith(monthPrefix) && t.status !== 'ARCHIVED'),
    [transactions, monthPrefix],
  );

  const totalBalance = useMemo(() => accounts.reduce((sum, a) => sum + (Number(a.attributes.currentBalance) || 0), 0), [accounts]);

  const actualIncome = monthTransactions.filter((t) => isActual(t.attributes) && t.attributes.amount > 0).reduce((s, t) => s + t.attributes.amount, 0);
  const actualExpense = monthTransactions
    .filter((t) => isActual(t.attributes) && t.attributes.amount < 0)
    .reduce((s, t) => s + Math.abs(t.attributes.amount), 0);
  const plannedInMonth = monthTransactions.filter((t) => t.attributes.isPlanned === true && (t.attributes.plannedStatus ?? 'PLANNED') === 'PLANNED');
  const plannedNet = plannedInMonth.reduce((s, t) => s + t.attributes.amount, 0);
  const forecastEndOfMonth = totalBalance + plannedNet;

  const byDay = useMemo(() => {
    const map = new Map<string, { actual: number; hasPlannedIncome: boolean; hasPlannedExpense: boolean }>();
    for (const t of monthTransactions) {
      const day = t.attributes.date;
      const entry = map.get(day) ?? { actual: 0, hasPlannedIncome: false, hasPlannedExpense: false };
      if (isActual(t.attributes)) {
        entry.actual += t.attributes.amount;
      } else {
        if (t.attributes.amount >= 0) entry.hasPlannedIncome = true;
        else entry.hasPlannedExpense = true;
      }
      map.set(day, entry);
    }
    return map;
  }, [monthTransactions]);

  const upcomingPlanned = useMemo(
    () =>
      transactions
        .filter((t) => t.attributes.isPlanned === true && (t.attributes.plannedStatus ?? 'PLANNED') === 'PLANNED' && t.attributes.date >= todayIso)
        .sort((a, b) => (a.attributes.date < b.attributes.date ? -1 : 1))
        .slice(0, 8),
    [transactions, todayIso],
  );

  const allPlanned = useMemo(
    () => transactions.filter((t) => t.attributes.isPlanned === true).sort((a, b) => (a.attributes.date < b.attributes.date ? -1 : 1)),
    [transactions],
  );

  const daysGrid = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(cursor.year, cursor.month, 1));
    const startWeekday = (firstOfMonth.getUTCDay() + 6) % 7; // 0 = Пн
    const daysInMonth = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
    const cells: { iso: string | null; day: number | null }[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push({ iso: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ iso: `${monthPrefix}-${pad(d)}`, day: d });
    }
    while (cells.length % 7 !== 0) cells.push({ iso: null, day: null });
    return cells;
  }, [cursor, monthPrefix]);

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(Date.UTC(c.year, c.month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
  }

  function openQuickAdd(dayIso?: string) {
    setForm({
      date: dayIso ?? todayIso,
      amount: '',
      accountId: accounts[0]?.id ?? '',
      categoryId: '',
      description: '',
    });
    setSelectedDay(dayIso ?? null);
    setCreating(true);
  }

  async function onSaveQuickAdd() {
    const amount = Number(form.amount);
    if (!form.date || !form.accountId || Number.isNaN(amount)) {
      toast.error('Укажите дату, счёт и сумму');
      return;
    }
    setSaving(true);
    try {
      const account = accounts.find((a) => a.id === form.accountId);
      await apiFetch('/entities', {
        method: 'POST',
        body: {
          entityType: 'financial_transaction',
          title: `${form.date}: ${form.description || 'план'}`,
          attributes: {
            date: form.date,
            amount,
            currency: account?.attributes.currency ?? 'RUB',
            accountId: form.accountId,
            categoryId: form.categoryId || undefined,
            description: form.description || (amount < 0 ? 'Плановый расход' : 'Плановый доход'),
            transactionType: amount < 0 ? 'EXPENSE' : 'INCOME',
            source: 'MANUAL',
            isPlanned: true,
            plannedStatus: 'PLANNED',
          },
        },
      });
      toast.success('Плановая операция добавлена');
      setCreating(false);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось добавить плановую операцию');
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

  async function onCancelPlanned(t: TransactionEntity) {
    try {
      await apiFetch(`/entities/${t.id}`, { method: 'PATCH', body: { attributes: { plannedStatus: 'CANCELLED' } } });
      toast.success('Плановая операция отменена');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось отменить операцию');
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

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Финансовый календарь</h1>
          <p className="mt-1 text-sm text-ink/60">Планирование доходов и расходов.</p>
        </div>
        <Button onClick={() => openQuickAdd()} disabled={accounts.length === 0}>
          <Plus size={16} /> Добавить плановую
        </Button>
      </div>

      <div className="mt-4">
        <FinanceSubNav active="/finance/calendar" />
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="mt-4 flex gap-1.5">
        <button
          onClick={() => setTab('calendar')}
          className={`rounded-card px-3 py-1.5 text-sm font-medium ${tab === 'calendar' ? 'bg-moss-500 text-white' : 'bg-paper-dim text-ink/70'}`}
        >
          Календарь
        </button>
        <button
          onClick={() => setTab('planned')}
          className={`rounded-card px-3 py-1.5 text-sm font-medium ${tab === 'planned' ? 'bg-moss-500 text-white' : 'bg-paper-dim text-ink/70'}`}
        >
          Плановые ({allPlanned.filter((t) => (t.attributes.plannedStatus ?? 'PLANNED') === 'PLANNED').length})
        </button>
      </div>

      {tab === 'calendar' && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <p className="text-sm text-ink/50">Текущий баланс</p>
              <p className="mt-1 font-display text-xl font-semibold text-ink">{totalBalance.toLocaleString('ru-RU')} ₽</p>
            </Card>
            <Card>
              <p className="text-sm text-ink/50">Фактические доходы за месяц</p>
              <p className="mt-1 font-display text-xl font-semibold text-moss-600">+{actualIncome.toLocaleString('ru-RU')} ₽</p>
            </Card>
            <Card>
              <p className="text-sm text-ink/50">Фактические расходы за месяц</p>
              <p className="mt-1 font-display text-xl font-semibold text-clay">-{actualExpense.toLocaleString('ru-RU')} ₽</p>
            </Card>
            <Card className={forecastEndOfMonth < 0 ? 'border-clay' : ''}>
              <p className="text-sm text-ink/50">Прогноз на конец месяца</p>
              <p className={`mt-1 font-display text-xl font-semibold ${forecastEndOfMonth < 0 ? 'text-clay' : 'text-ink'}`}>
                {forecastEndOfMonth.toLocaleString('ru-RU')} ₽
              </p>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <button onClick={() => shiftMonth(-1)} className="rounded-card p-1.5 hover:bg-paper-dim">
                  <ChevronLeft size={18} />
                </button>
                <span className="font-display text-lg font-semibold capitalize text-ink">
                  {MONTH_NAMES[cursor.month]} {cursor.year}
                </span>
                <button onClick={() => shiftMonth(1)} className="rounded-card p-1.5 hover:bg-paper-dim">
                  <ChevronRight size={18} />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-xs text-ink/40">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="py-1">
                    {w}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {daysGrid.map((cell, i) => {
                  if (!cell.iso) return <div key={i} />;
                  const entry = byDay.get(cell.iso);
                  const isToday = cell.iso === todayIso;
                  return (
                    <button
                      key={cell.iso}
                      onClick={() => openQuickAdd(cell.iso!)}
                      className={`flex h-16 flex-col items-start rounded-card border p-1.5 text-left text-xs hover:bg-paper-dim ${
                        isToday ? 'border-moss-500' : 'border-line'
                      }`}
                    >
                      <span className={isToday ? 'font-semibold text-moss-600' : 'text-ink/70'}>{cell.day}</span>
                      {entry && entry.actual !== 0 && (
                        <span className={entry.actual < 0 ? 'text-clay' : 'text-moss-600'}>{Math.round(entry.actual)}</span>
                      )}
                      <span className="flex gap-1">
                        {entry?.hasPlannedIncome && <span className="h-1.5 w-1.5 rounded-full border border-moss-500" />}
                        {entry?.hasPlannedExpense && <span className="h-1.5 w-1.5 rounded-full border border-clay" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>

            <Card>
              <h3 className="font-display text-base font-semibold text-ink">Ближайшие плановые</h3>
              <div className="mt-2 space-y-2">
                {upcomingPlanned.map((t) => (
                  <div key={t.id} className="rounded-card border border-line p-2 text-xs">
                    <p className="font-medium text-ink">{t.attributes.description}</p>
                    <p className="text-ink/50">{t.attributes.date}</p>
                    <p className={t.attributes.amount < 0 ? 'text-clay' : 'text-moss-600'}>
                      {t.attributes.amount > 0 ? '+' : ''}
                      {t.attributes.amount} {t.attributes.currency}
                    </p>
                  </div>
                ))}
                {upcomingPlanned.length === 0 && <p className="text-xs text-ink/50">Нет предстоящих плановых операций.</p>}
              </div>
              <div className="mt-3 border-t border-line pt-2 text-xs text-ink/50">
                <p className="mb-1 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full border border-moss-500" /> Плановые доходы
                </p>
                <p className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full border border-clay" /> Плановые расходы
                </p>
              </div>
            </Card>
          </div>
        </>
      )}

      {tab === 'planned' && (
        <Card className="mt-4">
          <div className="divide-y divide-line">
            {allPlanned.map((t) => {
              const status = t.attributes.plannedStatus ?? 'PLANNED';
              return (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div>
                    <p className="flex items-center gap-1.5 text-ink">
                      {t.attributes.description}
                      <Badge tone={status === 'PLANNED' ? 'gold' : status === 'COMPLETED' ? 'moss' : 'default'}>
                        {status === 'PLANNED' ? 'Запланирован' : status === 'COMPLETED' ? 'Совершён' : 'Отменён'}
                      </Badge>
                    </p>
                    <p className="text-xs text-ink/40">{t.attributes.date}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className={t.attributes.amount < 0 ? 'text-clay' : 'text-moss-600'}>
                      {t.attributes.amount > 0 ? '+' : ''}
                      {t.attributes.amount} {t.attributes.currency}
                    </p>
                    {status === 'PLANNED' && (
                      <>
                        <button onClick={() => onMarkCompleted(t)} title="Отметить как совершённую" className="text-moss-600 hover:opacity-70">
                          <CheckCircle2 size={16} />
                        </button>
                        <button onClick={() => onCancelPlanned(t)} title="Отменить" className="text-clay hover:opacity-70">
                          <Archive size={16} />
                        </button>
                      </>
                    )}
                    {status !== 'PLANNED' && (
                      <button onClick={() => onArchive(t)} title="Архивировать запись" className="text-ink/40 hover:text-clay">
                        <Archive size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {allPlanned.length === 0 && <p className="py-2 text-sm text-ink/50">Плановых операций пока нет.</p>}
          </div>
        </Card>
      )}

      {creating && (
        <Card className="animate-in mt-4">
          <h2 className="font-display text-lg font-semibold">Новая плановая операция{selectedDay ? ` — ${selectedDay}` : ''}</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <label className="mb-1 block text-xs text-ink/50">Счёт</label>
              <select
                value={form.accountId}
                onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
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
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-ink/50">Описание</label>
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={onSaveQuickAdd} disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}
    </AppShell>
  );
}
