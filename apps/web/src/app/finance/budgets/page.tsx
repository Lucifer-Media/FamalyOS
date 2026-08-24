'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText } from '@/components/ui';
import { Plus, Target } from 'lucide-react';

interface BudgetSummary {
  id: string;
  title: string;
  attributes: { budgetName?: string; plannedExpense?: number; currency?: string; startDate?: string; endDate?: string };
}

interface BudgetStatus {
  plannedExpense: number;
  spent: number;
  remaining: number;
  percentUsed: number | null;
}

export default function BudgetsPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { schema } = useEntityTypeSchema('budget');
  const [budgets, setBudgets] = useState<BudgetSummary[]>([]);
  const [statusByBudget, setStatusByBudget] = useState<Record<string, BudgetStatus>>({});
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');

  async function load() {
    const data = await apiFetch<BudgetSummary[]>('/entities?entityType=budget');
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

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Бюджеты</h1>
          <p className="mt-1 text-sm text-ink/60">Планируемые расходы по категориям, проектам, периодам.</p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} disabled={!schema}>
          <Plus size={16} /> Добавить бюджет
        </Button>
      </div>

      <ErrorText>{error}</ErrorText>

      {creating && schema && (
        <Card className="mt-4">
          <DynamicEntityForm schema={schema} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
          <div className="mt-3 flex gap-2">
            <Button onClick={onCreate}>Сохранить</Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {budgets.map((b) => {
          const status = statusByBudget[b.id];
          const percent = status?.percentUsed ?? 0;
          return (
            <Card key={b.id}>
              <div className="flex items-center gap-2">
                <Target size={16} className="text-ink/40" />
                <p className="font-medium text-ink">{b.title}</p>
              </div>
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
                </div>
              )}
            </Card>
          );
        })}
        {budgets.length === 0 && !creating && <p className="text-sm text-ink/50">Бюджетов пока нет.</p>}
      </div>
    </AppShell>
  );
}
