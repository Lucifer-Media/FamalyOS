'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { FinanceSubNav } from '@/components/finance-subnav';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Badge } from '@/components/ui';
import { toast } from 'sonner';
import { Plus, Target, Archive, ArchiveRestore } from 'lucide-react';

interface BudgetSummary {
  id: string;
  title: string;
  status: string;
  attributes: { budgetName?: string; plannedExpense?: number; currency?: string; startDate?: string; endDate?: string };
}

interface MatchedTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
}

interface BudgetStatus {
  plannedExpense: number;
  spent: number;
  remaining: number;
  percentUsed: number | null;
  matchedTransactions: MatchedTransaction[];
}

export default function BudgetsPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { schema } = useEntityTypeSchema('budget');
  const [budgets, setBudgets] = useState<BudgetSummary[]>([]);
  const [statusByBudget, setStatusByBudget] = useState<Record<string, BudgetStatus>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const [active, archived] = await Promise.all([
      apiFetch<BudgetSummary[]>('/entities?entityType=budget&status=ACTIVE'),
      apiFetch<BudgetSummary[]>('/entities?entityType=budget&status=ARCHIVED'),
    ]);
    const data = [...active, ...archived];
    setBudgets(data);
    for (const b of data) {
      apiFetch<BudgetStatus>(`/finance/budgets/${b.id}/status`)
        .then((s) => setStatusByBudget((prev) => ({ ...prev, [b.id]: s })))
        .catch(() => undefined);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function onCreate() {
    if (!schema) return;
    setError('');
    try {
      await apiFetch('/entities', {
        method: 'POST',
        body: { entityType: 'budget', title: (values.budgetName as string) || 'Бюджет', attributes: values },
      });
      setCreating(false);
      setValues({});
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось создать бюджет');
    }
  }

  async function onToggleArchive(b: BudgetSummary, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusyId(b.id);
    try {
      const nextAction = b.status === 'ARCHIVED' ? 'unarchive' : 'archive';
      await apiFetch(`/entities/${b.id}/${nextAction}`, { method: 'PATCH' });
      toast.success(nextAction === 'archive' ? 'Бюджет архивирован' : 'Бюджет восстановлен из архива');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Не удалось изменить статус бюджета');
    } finally {
      setBusyId(null);
    }
  }

  if (loading || !isAuthenticated) return null;

  const visibleBudgets = budgets.filter((b) => showArchived || b.status !== 'ARCHIVED');

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Бюджеты</h1>
          <p className="mt-1 text-sm text-ink/60">Планируемые расходы по категориям, проектам, периодам.</p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} disabled={!schema}>
          <Plus size={16} /> Добавить бюджет
        </Button>
      </div>

      <div className="mt-4">
        <FinanceSubNav active="/finance/budgets" />
      </div>

      <ErrorText>{error}</ErrorText>

      {creating && schema && (
        <Card className="animate-in mt-4">
          <DynamicEntityForm schema={schema} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
          <div className="mt-3 flex gap-2">
            <Button onClick={onCreate}>Сохранить</Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}

      <div className="mt-6 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">Все бюджеты</h2>
        <label className="flex items-center gap-2 text-sm text-ink/60">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 rounded border-line"
          />
          Показать архивные
        </label>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {visibleBudgets.map((b) => {
          const status = statusByBudget[b.id];
          const percent = status?.percentUsed ?? 0;
          return (
            <Link key={b.id} href={`/finance/budgets/${b.id}`}>
              <Card className={`h-full transition-shadow hover:shadow-md ${b.status === 'ARCHIVED' ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Target size={16} className="text-ink/40" />
                    <p className="font-medium text-ink">{b.title}</p>
                  </div>
                  <button
                    onClick={(e) => onToggleArchive(b, e)}
                    disabled={busyId === b.id}
                    title={b.status === 'ARCHIVED' ? 'Восстановить из архива' : 'Архивировать'}
                    className="shrink-0 rounded-card p-1.5 text-ink/40 hover:bg-paper-dim hover:text-ink"
                  >
                    {b.status === 'ARCHIVED' ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                  </button>
                </div>
                {b.status === 'ARCHIVED' && (
                  <div className="mt-1">
                    <Badge tone="gold">В архиве</Badge>
                  </div>
                )}
                {status && (
                  <div className="mt-3">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-paper-dim">
                      <div
                        className={`h-full ${percent > 100 ? 'bg-clay' : 'bg-moss-600'}`}
                        style={{ width: `${Math.min(percent, 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-ink/50">
                      Потрачено {status.spent} из {status.plannedExpense} · осталось {status.remaining}
                      {status.percentUsed != null && ` (${status.percentUsed}%)`}
                    </p>

                    {status.matchedTransactions.length > 0 && (
                      <details className="mt-2" onClick={(e) => e.stopPropagation()}>
                        <summary className="cursor-pointer text-xs text-clay">
                          Показать учтённые операции ({status.matchedTransactions.length})
                        </summary>
                        <ul className="mt-2 space-y-1 border-t border-line pt-2">
                          {status.matchedTransactions.map((t) => (
                            <li key={t.id} className="flex items-center justify-between text-xs">
                              <span className="text-ink/70">
                                {t.date} · {t.description || t.category}
                              </span>
                              <span className="text-clay">{t.amount}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </Card>
            </Link>
          );
        })}
        {visibleBudgets.length === 0 && !creating && <p className="text-sm text-ink/50">Бюджетов пока нет.</p>}
      </div>
    </AppShell>
  );
}
