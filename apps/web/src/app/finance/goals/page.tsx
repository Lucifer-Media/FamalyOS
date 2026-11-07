'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { FinanceSubNav } from '@/components/finance-subnav';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, Badge, ErrorText } from '@/components/ui';
import { money, ruDate, inputClass } from '@/lib/finance-format';
import { toast } from 'sonner';
import { Plus, PiggyBank, Minus, History, ExternalLink } from 'lucide-react';

interface GoalSummary {
  goalId: string;
  name: string;
  icon?: string;
  currency: string;
  targetAmount: number;
  savedAmount: number;
  remaining: number;
  percent: number;
  averageMonthlyContribution: number;
  monthsToGoal: number | null;
  estimatedDate: string | null;
  requiredMonthlyForDeadline: number | null;
  onTrack: boolean | null;
  isCompleted: boolean;
  deadline?: string;
  contributionsCount: number;
  entityStatus: string;
}
interface Contribution {
  id: string;
  date: string;
  amount: number;
  note?: string;
}
interface Named {
  id: string;
  title: string;
}

const EMPTY_GOAL = { name: '', targetAmount: '', deadline: '', startAmount: '', icon: '', trackingMode: 'CONTRIBUTIONS', savingsAccountId: '' };

export default function GoalsPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const [goals, setGoals] = useState<GoalSummary[]>([]);
  const [accounts, setAccounts] = useState<Named[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_GOAL);
  const [contrib, setContrib] = useState<{ goalId: string; sign: 1 | -1; amount: string; note: string } | null>(null);
  const [history, setHistory] = useState<{ goalId: string; items: Contribution[] } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [g, a] = await Promise.all([apiFetch<GoalSummary[]>('/finance/goals/summary'), apiFetch<Named[]>('/entities?entityType=bank_account&status=ACTIVE')]);
    setGoals(g.filter((x) => x.entityStatus === 'ACTIVE'));
    setAccounts(a);
  }, []);

  useEffect(() => {
    if (isAuthenticated) load().catch((e) => setError(e.message));
  }, [isAuthenticated, load]);

  async function createGoal() {
    setError('');
    const target = Number(form.targetAmount.replace(',', '.'));
    if (!form.name.trim() || !(target > 0)) {
      setError('Укажите название и целевую сумму');
      return;
    }
    try {
      await apiFetch('/entities', {
        method: 'POST',
        body: {
          entityType: 'financial_goal',
          title: form.name,
          attributes: {
            name: form.name,
            targetAmount: target,
            currency: 'RUB',
            deadline: form.deadline || undefined,
            startAmount: form.startAmount ? Number(form.startAmount.replace(',', '.')) : undefined,
            icon: form.icon || undefined,
            trackingMode: form.trackingMode,
            savingsAccountId: form.trackingMode === 'ACCOUNT_BALANCE' && form.savingsAccountId ? form.savingsAccountId : undefined,
            status: 'ACTIVE',
          },
        },
      });
      toast.success('Копилка создана');
      setCreating(false);
      setForm(EMPTY_GOAL);
      await load();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { errors?: string[] }) : undefined;
      setError(body?.errors?.join('; ') ?? (e as Error).message);
    }
  }

  async function saveContribution() {
    if (!contrib) return;
    const amount = Number(contrib.amount.replace(',', '.'));
    if (!(amount > 0)) return;
    try {
      await apiFetch(`/finance/goals/${contrib.goalId}/contributions`, { method: 'POST', body: { amount: amount * contrib.sign, note: contrib.note || undefined } });
      toast.success(contrib.sign > 0 ? 'Копилка пополнена' : 'Изъятие записано');
      setContrib(null);
      await load();
      if (history?.goalId === contrib.goalId) await openHistory(contrib.goalId);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function openHistory(goalId: string) {
    const items = await apiFetch<Contribution[]>(`/finance/goals/${goalId}/contributions`);
    setHistory({ goalId, items });
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Семейные копилки</h1>
          <p className="mt-1 text-sm text-ink/60">Цели, пополнения и прогноз «когда накопим» по реальному темпу за последние месяцы.</p>
        </div>
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus size={16} /> Новая копилка
        </Button>
      </div>
      <div className="mt-4">
        <FinanceSubNav active="/finance/goals" />
      </div>
      <ErrorText>{error}</ErrorText>

      {creating && (
        <Card className="animate-in mt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Название</span>
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Отпуск в Ереване" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Цель, ₽</span>
              <input className={inputClass} inputMode="decimal" value={form.targetAmount} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} placeholder="150000" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Срок (необязательно)</span>
              <input type="date" className={inputClass} value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Эмодзи</span>
              <input className={inputClass} value={form.icon} maxLength={4} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="✈️" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Как считать накопленное</span>
              <select className={inputClass} value={form.trackingMode} onChange={(e) => setForm({ ...form, trackingMode: e.target.value })}>
                <option value="CONTRIBUTIONS">По пополнениям, которые вносим здесь</option>
                <option value="ACCOUNT_BALANCE">По балансу отдельного счёта</option>
              </select>
            </label>
            {form.trackingMode === 'ACCOUNT_BALANCE' ? (
              <label className="text-sm">
                <span className="mb-1 block text-ink/70">Счёт копилки</span>
                <select className={inputClass} value={form.savingsAccountId} onChange={(e) => setForm({ ...form, savingsAccountId: e.target.value })}>
                  <option value="">— выберите —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="text-sm">
                <span className="mb-1 block text-ink/70">Уже накоплено, ₽</span>
                <input className={inputClass} inputMode="decimal" value={form.startAmount} onChange={(e) => setForm({ ...form, startAmount: e.target.value })} placeholder="0" />
              </label>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={createGoal}>Создать</Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {goals.map((g) => (
          <Card key={g.goalId} className="min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-xl">{g.icon || <PiggyBank size={20} className="text-ink/40" />}</span>
                <p className="truncate font-medium">{g.name}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {g.isCompleted ? <Badge tone="moss">цель достигнута</Badge> : g.onTrack === false ? <Badge tone="clay">отстаём</Badge> : g.onTrack ? <Badge tone="moss">успеваем</Badge> : null}
                <Link href={`/documents/financial_goal/${g.goalId}`} className="rounded-card p-1 text-ink/40 hover:bg-paper-dim" title="Карточка цели">
                  <ExternalLink size={14} />
                </Link>
              </div>
            </div>
            <p className="mt-3 font-display text-xl font-semibold">
              {money(g.savedAmount, g.currency)} <span className="text-sm font-normal text-ink/50">из {money(g.targetAmount, g.currency)}</span>
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-paper-dim">
              <div className={`h-full transition-[width] duration-500 ${g.isCompleted ? 'bg-moss-600' : 'bg-moss-500'}`} style={{ width: `${g.percent}%` }} />
            </div>
            <div className="mt-2 space-y-0.5 text-xs text-ink/60">
              <p>
                {g.percent}% · осталось {money(g.remaining, g.currency)}
                {g.deadline && ` · срок ${ruDate(g.deadline)}`}
              </p>
              {!g.isCompleted && (
                <p>
                  {g.averageMonthlyContribution > 0
                    ? `Темп ≈ ${money(g.averageMonthlyContribution, g.currency)}/мес → накопим к ${ruDate(g.estimatedDate)}`
                    : 'Пополнений за последние месяцы нет — прогноз появится после первых взносов'}
                </p>
              )}
              {g.requiredMonthlyForDeadline !== null && !g.isCompleted && <p>Чтобы успеть к сроку: {money(g.requiredMonthlyForDeadline, g.currency)}/мес</p>}
            </div>

            {contrib?.goalId === g.goalId ? (
              <div className="animate-in mt-3 flex flex-wrap gap-2">
                <input autoFocus inputMode="decimal" className={`${inputClass} w-28`} placeholder="Сумма" value={contrib.amount} onChange={(e) => setContrib({ ...contrib, amount: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && saveContribution()} />
                <input className={`${inputClass} min-w-0 flex-1`} placeholder="Комментарий" value={contrib.note} onChange={(e) => setContrib({ ...contrib, note: e.target.value })} />
                <Button onClick={saveContribution}>{contrib.sign > 0 ? 'Пополнить' : 'Снять'}</Button>
                <Button variant="ghost" onClick={() => setContrib(null)}>
                  ×
                </Button>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setContrib({ goalId: g.goalId, sign: 1, amount: '', note: '' })}>
                  <Plus size={14} /> Пополнить
                </Button>
                <Button variant="ghost" onClick={() => setContrib({ goalId: g.goalId, sign: -1, amount: '', note: '' })}>
                  <Minus size={14} /> Снять
                </Button>
                <Button variant="ghost" onClick={() => (history?.goalId === g.goalId ? setHistory(null) : openHistory(g.goalId))}>
                  <History size={14} /> {g.contributionsCount}
                </Button>
              </div>
            )}

            {history?.goalId === g.goalId && (
              <div className="animate-in mt-3 max-h-48 divide-y divide-line overflow-y-auto border-t border-line text-sm">
                {history.items.map((c) => (
                  <div key={c.id} className="flex justify-between gap-2 py-1">
                    <span className="truncate text-ink/70">
                      {ruDate(c.date)} {c.note ? `· ${c.note}` : ''}
                    </span>
                    <span className={c.amount >= 0 ? 'text-moss-600' : 'text-clay'}>
                      {c.amount >= 0 ? '+' : ''}
                      {money(c.amount, g.currency)}
                    </span>
                  </div>
                ))}
                {history.items.length === 0 && <p className="py-1 text-ink/50">Пополнений пока нет.</p>}
              </div>
            )}
          </Card>
        ))}
        {goals.length === 0 && !creating && <p className="text-sm text-ink/50">Копилок пока нет.</p>}
      </div>
    </AppShell>
  );
}
