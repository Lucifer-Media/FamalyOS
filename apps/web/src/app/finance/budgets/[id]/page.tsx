'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { FinanceSubNav } from '@/components/finance-subnav';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Badge } from '@/components/ui';
import { toast } from 'sonner';
import { Save, Archive, ArchiveRestore, History, Plus, Trash2 } from 'lucide-react';

interface BudgetDetail {
  id: string;
  title: string;
  status: string;
  currentVersion: number;
  attributes: Record<string, unknown> & {
    budgetName?: string;
    plannedExpense?: number;
    periodBreakdownType?: PeriodType;
    periodAllocations?: PeriodAllocation[];
  };
}

interface VersionEntry {
  versionNumber: number;
  action: string;
  changeSummary: string | null;
  changedAt: string;
}

type PeriodType = 'YEARLY' | 'MONTHLY' | 'WEEKLY';

interface PeriodAllocation {
  period: string;
  plannedAmount: number;
  note?: string;
}

interface PeriodSpendSummary {
  period: string;
  label: string;
  planned: number;
  spent: number;
  remaining: number;
  percentUsed: number | null;
}

const PERIOD_TYPE_LABELS: Record<PeriodType, string> = {
  YEARLY: 'По годам',
  MONTHLY: 'По месяцам',
  WEEKLY: 'По неделям',
};

function inputTypeFor(periodType: PeriodType): 'number' | 'month' | 'week' {
  if (periodType === 'YEARLY') return 'number';
  if (periodType === 'MONTHLY') return 'month';
  return 'week';
}

export default function BudgetDetailPage() {
  const { loading: authLoading, isAuthenticated } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { schema } = useEntityTypeSchema('budget');
  const [budget, setBudget] = useState<BudgetDetail | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [showVersions, setShowVersions] = useState(false);

  // Разбивка по периодам — своё состояние, не завязано на общую форму,
  // чтобы можно было сохранять её отдельной кнопкой.
  const [periodType, setPeriodType] = useState<PeriodType>('MONTHLY');
  const [allocations, setAllocations] = useState<PeriodAllocation[]>([]);
  const [newPeriodKey, setNewPeriodKey] = useState('');
  const [newPeriodAmount, setNewPeriodAmount] = useState('');
  const [savingPeriods, setSavingPeriods] = useState(false);
  const [periodSummary, setPeriodSummary] = useState<PeriodSpendSummary[]>([]);

  async function load() {
    const data = await apiFetch<BudgetDetail>(`/entities/${params.id}`);
    setBudget(data);
    setValues(data.attributes ?? {});
    setPeriodType((data.attributes.periodBreakdownType as PeriodType) || 'MONTHLY');
    setAllocations(Array.isArray(data.attributes.periodAllocations) ? data.attributes.periodAllocations : []);
    await loadPeriodStatus();
  }

  async function loadPeriodStatus() {
    try {
      const result = await apiFetch<{ periodType: PeriodType; periods: PeriodSpendSummary[] } | null>(
        `/finance/budgets/${params.id}/periods`,
      );
      setPeriodSummary(result?.periods ?? []);
    } catch {
      setPeriodSummary([]);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function onSave() {
    setSaving(true);
    setError('');
    try {
      const updated = await apiFetch<BudgetDetail>(`/entities/${params.id}`, {
        method: 'PATCH',
        body: { attributes: values },
      });
      setBudget(updated);
      setValues(updated.attributes ?? {});
      toast.success('Бюджет сохранён');
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setError(Array.isArray((e.body as any)?.errors) ? (e.body as any).errors.join('; ') : e.message);
      } else {
        setError(e instanceof ApiError ? e.message : 'Не удалось сохранить бюджет');
      }
    } finally {
      setSaving(false);
    }
  }

  async function onToggleArchive() {
    if (!budget) return;
    setArchiveBusy(true);
    try {
      const nextAction = budget.status === 'ARCHIVED' ? 'unarchive' : 'archive';
      const updated = await apiFetch<BudgetDetail>(`/entities/${params.id}/${nextAction}`, { method: 'PATCH' });
      setBudget(updated);
      toast.success(nextAction === 'archive' ? 'Бюджет архивирован' : 'Бюджет восстановлен из архива');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось изменить статус бюджета');
    } finally {
      setArchiveBusy(false);
    }
  }

  async function loadVersions() {
    const v = await apiFetch<VersionEntry[]>(`/entities/${params.id}/versions`);
    setVersions(v);
    setShowVersions((s) => !s);
  }

  function normalizedPeriodKey(raw: string): string {
    if (!raw) return '';
    if (periodType === 'WEEKLY') {
      // <input type="week"> отдаёт формат '2026-W36' — уже подходит
      return raw;
    }
    return raw;
  }

  function onAddAllocation() {
    const key = normalizedPeriodKey(newPeriodKey);
    const amount = Number(newPeriodAmount);
    if (!key || Number.isNaN(amount) || amount <= 0) {
      toast.error('Укажите период и сумму больше нуля');
      return;
    }
    if (allocations.some((a) => a.period === key)) {
      toast.error('Такой период уже добавлен — удалите старую строку или измените её сумму');
      return;
    }
    setAllocations((prev) => [...prev, { period: key, plannedAmount: amount }]);
    setNewPeriodKey('');
    setNewPeriodAmount('');
  }

  function onRemoveAllocation(period: string) {
    setAllocations((prev) => prev.filter((a) => a.period !== period));
  }

  function onChangePeriodType(next: PeriodType) {
    if (allocations.length > 0 && next !== periodType) {
      if (!confirm('Смена типа периода очистит текущую разбивку. Продолжить?')) return;
      setAllocations([]);
    }
    setPeriodType(next);
  }

  async function onSavePeriods() {
    setSavingPeriods(true);
    try {
      const updated = await apiFetch<BudgetDetail>(`/entities/${params.id}`, {
        method: 'PATCH',
        body: { attributes: { periodBreakdownType: periodType, periodAllocations: allocations } },
      });
      setBudget(updated);
      setValues(updated.attributes ?? {});
      await loadPeriodStatus();
      toast.success('Разбивка по периодам сохранена');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось сохранить разбивку по периодам');
    } finally {
      setSavingPeriods(false);
    }
  }

  if (authLoading || !isAuthenticated) return null;

  return (
    <AppShell>
      <button onClick={() => router.push('/finance/budgets')} className="mb-3 text-sm text-ink/50 hover:underline">
        ← К списку бюджетов
      </button>

      <FinanceSubNav active="/finance/budgets" />

      {!budget && !error && <p className="mt-4 text-sm text-ink/50">Загрузка…</p>}
      <ErrorText>{error}</ErrorText>

      {budget && schema && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold text-ink">{budget.title}</h1>
              {budget.status === 'ARCHIVED' && <Badge tone="gold">В архиве</Badge>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={loadVersions}>
                <History size={16} /> Версии (v{budget.currentVersion})
              </Button>
              <Button variant="secondary" onClick={onToggleArchive} disabled={archiveBusy}>
                {budget.status === 'ARCHIVED' ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                {budget.status === 'ARCHIVED' ? 'Восстановить' : 'Архивировать'}
              </Button>
              <Button onClick={onSave} disabled={saving}>
                <Save size={16} /> {saving ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </div>

          <Card className="mt-4">
            <DynamicEntityForm schema={schema} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
          </Card>

          {showVersions && (
            <Card className="mt-4">
              <h3 className="font-display text-lg font-semibold">История изменений</h3>
              <ul className="mt-2 divide-y divide-line">
                {versions.map((v) => (
                  <li key={v.versionNumber} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      <span className="font-medium">v{v.versionNumber}</span> — {v.action} ·{' '}
                      <span className="text-ink/50">{new Date(v.changedAt).toLocaleString('ru-RU')}</span>
                    </span>
                  </li>
                ))}
                {versions.length === 0 && <p className="py-2 text-sm text-ink/50">История пуста.</p>}
              </ul>
            </Card>
          )}

          <Card className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">Разбивка бюджета по периодам</h2>
              <div className="flex gap-1.5">
                {(Object.keys(PERIOD_TYPE_LABELS) as PeriodType[]).map((pt) => (
                  <button
                    key={pt}
                    onClick={() => onChangePeriodType(pt)}
                    className={`rounded-card px-3 py-1.5 text-xs font-medium ${
                      periodType === pt ? 'bg-moss-500 text-white' : 'bg-paper-dim text-ink/70 hover:bg-line/40'
                    }`}
                  >
                    {PERIOD_TYPE_LABELS[pt]}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-sm text-ink/60">
              Позволяет расписать общий план бюджета точнее — по годам, месяцам или неделям — и видеть факт по каждому
              периоду отдельно.
            </p>

            <div className="mt-4 flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs text-ink/50">
                  {periodType === 'YEARLY' ? 'Год' : periodType === 'MONTHLY' ? 'Месяц' : 'Неделя'}
                </label>
                <input
                  type={inputTypeFor(periodType)}
                  value={newPeriodKey}
                  onChange={(e) => setNewPeriodKey(e.target.value)}
                  placeholder={periodType === 'YEARLY' ? '2026' : undefined}
                  min={periodType === 'YEARLY' ? 2000 : undefined}
                  max={periodType === 'YEARLY' ? 2100 : undefined}
                  className="w-40 rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-ink/50">Плановая сумма</label>
                <input
                  type="number"
                  step="0.01"
                  value={newPeriodAmount}
                  onChange={(e) => setNewPeriodAmount(e.target.value)}
                  className="w-36 rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
                  placeholder="10000"
                />
              </div>
              <Button variant="secondary" onClick={onAddAllocation}>
                <Plus size={16} /> Добавить период
              </Button>
            </div>

            {allocations.length > 0 && (
              <div className="mt-4 divide-y divide-line border-t border-line">
                {allocations
                  .slice()
                  .sort((a, b) => (a.period < b.period ? -1 : 1))
                  .map((a) => {
                    const summary = periodSummary.find((p) => p.period === a.period);
                    const percent = summary?.percentUsed ?? 0;
                    return (
                      <div key={a.period} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <div className="w-32 shrink-0 text-ink">{summary?.label ?? a.period}</div>
                        <div className="flex-1">
                          <div className="h-2 w-full overflow-hidden rounded-full bg-paper-dim">
                            <div
                              className={`h-full ${percent > 100 ? 'bg-clay' : 'bg-moss-600'}`}
                              style={{ width: `${Math.min(percent, 100)}%` }}
                            />
                          </div>
                          <p className="mt-1 text-xs text-ink/50">
                            {summary ? (
                              <>
                                Потрачено {summary.spent} из {summary.planned}
                                {summary.percentUsed != null && ` (${summary.percentUsed}%)`}
                              </>
                            ) : (
                              `План: ${a.plannedAmount}`
                            )}
                          </p>
                        </div>
                        <button
                          onClick={() => onRemoveAllocation(a.period)}
                          title="Удалить период"
                          className="shrink-0 rounded-card p-1.5 text-ink/40 hover:bg-paper-dim hover:text-clay"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
              </div>
            )}
            {allocations.length === 0 && <p className="mt-3 text-sm text-ink/50">Периоды пока не добавлены.</p>}

            <div className="mt-4">
              <Button onClick={onSavePeriods} disabled={savingPeriods}>
                <Save size={16} /> {savingPeriods ? 'Сохраняем…' : 'Сохранить разбивку'}
              </Button>
            </div>
          </Card>
        </>
      )}
    </AppShell>
  );
}
