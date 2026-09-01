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
import { Save, Archive, ArchiveRestore, History, Calculator, ArrowLeftRight } from 'lucide-react';

interface LoanDetail {
  id: string;
  title: string;
  status: string;
  currentVersion: number;
  attributes: Record<string, unknown> & { currency?: string };
}

interface VersionEntry {
  versionNumber: number;
  action: string;
  changeSummary: string | null;
  changedAt: string;
}

interface ScheduleRow {
  paymentNumber: number;
  date: string;
  payment: number;
  principalPart: number;
  interestPart: number;
  remainingBalance: number;
}

interface EarlyRepaymentResult {
  schedule: ScheduleRow[];
  totalInterestBefore: number;
  totalInterestAfter: number;
  interestSaved: number;
  monthsBefore: number;
  monthsAfter: number;
  monthsSaved: number;
}

interface RefinanceResult {
  currentTotalCost: number;
  newTotalCost: number;
  savings: number;
  newMonthlyPayment: number;
  currentMonthlyPayment: number;
}

function fmt(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

export default function LoanDetailPage() {
  const { loading: authLoading, isAuthenticated } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { schema } = useEntityTypeSchema('loan_account');
  const [loan, setLoan] = useState<LoanDetail | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [showVersions, setShowVersions] = useState(false);

  const [extraPayment, setExtraPayment] = useState('');
  const [fromPaymentNumber, setFromPaymentNumber] = useState('1');
  const [mode, setMode] = useState<'REDUCE_TERM' | 'REDUCE_PAYMENT'>('REDUCE_TERM');
  const [simResult, setSimResult] = useState<EarlyRepaymentResult | null>(null);
  const [simulating, setSimulating] = useState(false);

  const [newRate, setNewRate] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [newFees, setNewFees] = useState('');
  const [refiResult, setRefiResult] = useState<RefinanceResult | null>(null);
  const [comparing, setComparing] = useState(false);

  async function load() {
    const [data, sched] = await Promise.all([
      apiFetch<LoanDetail>(`/entities/${params.id}`),
      apiFetch<{ schedule: ScheduleRow[] }>(`/finance/portfolio/loans/${params.id}/schedule`),
    ]);
    setLoan(data);
    setValues(data.attributes ?? {});
    setSchedule(sched.schedule);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function onSave() {
    setSaving(true);
    setError('');
    try {
      const updated = await apiFetch<LoanDetail>(`/entities/${params.id}`, { method: 'PATCH', body: { attributes: values } });
      setLoan(updated);
      setValues(updated.attributes ?? {});
      const sched = await apiFetch<{ schedule: ScheduleRow[] }>(`/finance/portfolio/loans/${params.id}/schedule`);
      setSchedule(sched.schedule);
      toast.success('Кредит сохранён');
    } catch (e) {
      setError(e instanceof ApiError ? (Array.isArray((e.body as any)?.errors) ? (e.body as any).errors.join('; ') : e.message) : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  async function onToggleArchive() {
    if (!loan) return;
    setArchiveBusy(true);
    try {
      const nextAction = loan.status === 'ARCHIVED' ? 'unarchive' : 'archive';
      const updated = await apiFetch<LoanDetail>(`/entities/${params.id}/${nextAction}`, { method: 'PATCH' });
      setLoan(updated);
      toast.success(nextAction === 'archive' ? 'Кредит архивирован' : 'Кредит восстановлен из архива');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось изменить статус');
    } finally {
      setArchiveBusy(false);
    }
  }

  async function loadVersions() {
    const v = await apiFetch<VersionEntry[]>(`/entities/${params.id}/versions`);
    setVersions(v);
    setShowVersions((s) => !s);
  }

  async function onSimulate() {
    const amount = Number(extraPayment);
    if (!amount || amount <= 0) {
      toast.error('Укажите сумму досрочного платежа');
      return;
    }
    setSimulating(true);
    try {
      const result = await apiFetch<EarlyRepaymentResult>(`/finance/portfolio/loans/${params.id}/simulate-early-repayment`, {
        method: 'POST',
        body: { extraPayment: amount, fromPaymentNumber: Number(fromPaymentNumber) || 1, mode },
      });
      setSimResult(result);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось рассчитать симуляцию');
    } finally {
      setSimulating(false);
    }
  }

  async function onCompareRefinance() {
    const rate = Number(newRate);
    const term = Number(newTerm);
    if (!rate || !term) {
      toast.error('Укажите ставку и срок нового кредита');
      return;
    }
    setComparing(true);
    try {
      const result = await apiFetch<RefinanceResult>(`/finance/portfolio/loans/${params.id}/compare-refinance`, {
        method: 'POST',
        body: { annualRatePercent: rate, termMonths: term, feesFlat: Number(newFees) || 0 },
      });
      setRefiResult(result);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось сравнить рефинансирование');
    } finally {
      setComparing(false);
    }
  }

  if (authLoading || !isAuthenticated) return null;

  return (
    <AppShell>
      <button onClick={() => router.push('/finance/portfolio')} className="mb-3 text-sm text-ink/50 hover:underline">
        ← К портфелю
      </button>

      <FinanceSubNav active="/finance/portfolio" />

      {!loan && !error && <p className="mt-4 text-sm text-ink/50">Загрузка…</p>}
      <ErrorText>{error}</ErrorText>

      {loan && schema && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold text-ink">{loan.title}</h1>
              {loan.status === 'ARCHIVED' && <Badge tone="gold">В архиве</Badge>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={loadVersions}>
                <History size={16} /> Версии (v{loan.currentVersion})
              </Button>
              <Button variant="secondary" onClick={onToggleArchive} disabled={archiveBusy}>
                {loan.status === 'ARCHIVED' ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                {loan.status === 'ARCHIVED' ? 'Восстановить' : 'Архивировать'}
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
              </ul>
            </Card>
          )}

          <Card className="mt-4">
            <h2 className="font-display text-lg font-semibold">График платежей</h2>
            <p className="mt-1 text-xs text-ink/50">
              Оценочный аннуитетный график от текущего остатка (реальный график банка может немного отличаться из-за дат и округлений).
            </p>
            <div className="mt-3 max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-paper-card text-ink/40">
                  <tr>
                    <th className="py-1 text-left">#</th>
                    <th className="py-1 text-left">Дата</th>
                    <th className="py-1 text-right">Платёж</th>
                    <th className="py-1 text-right">Тело</th>
                    <th className="py-1 text-right">Проценты</th>
                    <th className="py-1 text-right">Остаток</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((r) => (
                    <tr key={r.paymentNumber} className="border-t border-line">
                      <td className="py-1">{r.paymentNumber}</td>
                      <td className="py-1">{r.date}</td>
                      <td className="py-1 text-right">{fmt(r.payment)}</td>
                      <td className="py-1 text-right text-moss-600">{fmt(r.principalPart)}</td>
                      <td className="py-1 text-right text-clay">{fmt(r.interestPart)}</td>
                      <td className="py-1 text-right">{fmt(r.remainingBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mt-4">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <Calculator size={18} className="text-ink/40" /> Симуляция досрочного погашения
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-ink/50">Сумма досрочного платежа</label>
                <input
                  type="number"
                  value={extraPayment}
                  onChange={(e) => setExtraPayment(e.target.value)}
                  className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-ink/50">С какого платежа</label>
                <input
                  type="number"
                  min={1}
                  value={fromPaymentNumber}
                  onChange={(e) => setFromPaymentNumber(e.target.value)}
                  className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-ink/50">Режим</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'REDUCE_TERM' | 'REDUCE_PAYMENT')}
                  className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
                >
                  <option value="REDUCE_TERM">Сократить срок</option>
                  <option value="REDUCE_PAYMENT">Сократить платёж</option>
                </select>
              </div>
              <div className="flex items-end">
                <Button onClick={onSimulate} disabled={simulating}>
                  {simulating ? 'Считаем…' : 'Рассчитать'}
                </Button>
              </div>
            </div>
            {simResult && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-card bg-paper-dim p-3">
                  <p className="text-xs text-ink/50">Экономия на процентах</p>
                  <p className="font-display text-lg font-semibold text-moss-600">{fmt(simResult.interestSaved)} ₽</p>
                </div>
                <div className="rounded-card bg-paper-dim p-3">
                  <p className="text-xs text-ink/50">Сокращение срока</p>
                  <p className="font-display text-lg font-semibold text-ink">{simResult.monthsSaved} мес.</p>
                </div>
                <div className="rounded-card bg-paper-dim p-3">
                  <p className="text-xs text-ink/50">Было платежей</p>
                  <p className="font-display text-lg font-semibold text-ink">{simResult.monthsBefore}</p>
                </div>
                <div className="rounded-card bg-paper-dim p-3">
                  <p className="text-xs text-ink/50">Станет платежей</p>
                  <p className="font-display text-lg font-semibold text-ink">{simResult.monthsAfter}</p>
                </div>
              </div>
            )}
          </Card>

          <Card className="mt-4">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <ArrowLeftRight size={18} className="text-ink/40" /> Сравнение выгоды рефинансирования
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-ink/50">Новая ставка, % годовых</label>
                <input
                  type="number"
                  value={newRate}
                  onChange={(e) => setNewRate(e.target.value)}
                  className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-ink/50">Новый срок, мес.</label>
                <input
                  type="number"
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)}
                  className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-ink/50">Комиссии/расходы на переоформление</label>
                <input
                  type="number"
                  value={newFees}
                  onChange={(e) => setNewFees(e.target.value)}
                  className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
                />
              </div>
              <div className="flex items-end">
                <Button onClick={onCompareRefinance} disabled={comparing}>
                  {comparing ? 'Считаем…' : 'Сравнить'}
                </Button>
              </div>
            </div>
            {refiResult && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-card bg-paper-dim p-3">
                  <p className="text-xs text-ink/50">Текущий платёж</p>
                  <p className="font-display text-lg font-semibold text-ink">{fmt(refiResult.currentMonthlyPayment)} ₽</p>
                </div>
                <div className="rounded-card bg-paper-dim p-3">
                  <p className="text-xs text-ink/50">Новый платёж</p>
                  <p className="font-display text-lg font-semibold text-ink">{fmt(refiResult.newMonthlyPayment)} ₽</p>
                </div>
                <div className="rounded-card bg-paper-dim p-3 sm:col-span-2">
                  <p className="text-xs text-ink/50">{refiResult.savings >= 0 ? 'Экономия при рефинансировании' : 'Рефинансирование невыгодно, переплата'}</p>
                  <p className={`font-display text-lg font-semibold ${refiResult.savings >= 0 ? 'text-moss-600' : 'text-clay'}`}>
                    {fmt(Math.abs(refiResult.savings))} ₽
                  </p>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </AppShell>
  );
}
