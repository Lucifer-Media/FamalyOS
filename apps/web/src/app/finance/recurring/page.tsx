'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { FinanceSubNav } from '@/components/finance-subnav';
import { apiFetch } from '@/lib/api';
import { Button, Card, Badge, ErrorText } from '@/components/ui';
import { money, ruDate, monthLabel } from '@/lib/finance-format';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Repeat, Plus, CheckCircle2, Clock, AlertCircle, Loader2 } from 'lucide-react';

interface NeedStatus {
  needId: string;
  name: string;
  plannedAmount: number;
  paidAmount: number;
  status: 'PAID' | 'DUE' | 'OVERDUE';
  dueDate: string | null;
  matchedTransactionIds: string[];
  priority?: string;
}
interface StatusResponse {
  month: string;
  planned: number;
  paid: number;
  overdueCount: number;
  items: NeedStatus[];
}
interface Candidate {
  key: string;
  label: string;
  period: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  averageAmount: number;
  lastAmount: number;
  occurrences: number;
  lastDate: string;
  nextExpectedDate: string;
  categoryId?: string;
  monthlyEquivalent: number;
  alreadyTracked: boolean;
}

const PERIOD_LABEL: Record<Candidate['period'], string> = { WEEKLY: 'еженедельно', MONTHLY: 'ежемесячно', QUARTERLY: 'раз в квартал', YEARLY: 'раз в год' };

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export default function RecurringPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [showTracked, setShowTracked] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async (m: string) => {
    setStatus(await apiFetch<StatusResponse>(`/finance/recurring/status?month=${m}`));
  }, []);
  const loadCandidates = useCallback(async () => {
    setCandidates(await apiFetch<Candidate[]>('/finance/recurring/candidates'));
  }, []);

  useEffect(() => {
    if (isAuthenticated) loadStatus(month).catch((e) => setError(e.message));
  }, [isAuthenticated, month, loadStatus]);
  useEffect(() => {
    if (isAuthenticated) loadCandidates().catch((e) => setError(e.message));
  }, [isAuthenticated, loadCandidates]);

  const visibleCandidates = useMemo(() => (candidates ?? []).filter((c) => showTracked || !c.alreadyTracked), [candidates, showTracked]);
  const subscriptionsMonthly = useMemo(() => (candidates ?? []).reduce((s, c) => s + c.monthlyEquivalent, 0), [candidates]);

  async function track(c: Candidate) {
    setBusyKey(c.key);
    try {
      await apiFetch('/finance/recurring/track', {
        method: 'POST',
        body: {
          name: c.label,
          amount: c.averageAmount,
          matchPattern: c.key,
          period: c.period,
          categoryId: c.categoryId,
          nextDueDate: c.nextExpectedDate,
          isSubscription: c.averageAmount < 3000,
        },
      });
      toast.success(`«${c.label}» добавлен в обязательные платежи`);
      await Promise.all([loadCandidates(), loadStatus(month)]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold text-ink">Подписки и регулярные платежи</h1>
      <p className="mt-1 text-sm text-ink/60">Обязательные платежи месяца и то, что Family OS нашёл повторяющимся в истории операций.</p>
      <div className="mt-4">
        <FinanceSubNav active="/finance/recurring" />
      </div>
      <ErrorText>{error}</ErrorText>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Предыдущий месяц">
              <ChevronLeft size={16} />
            </Button>
            <h2 className="min-w-[150px] text-center font-display text-lg font-semibold capitalize">{monthLabel(month)}</h2>
            <Button variant="ghost" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Следующий месяц">
              <ChevronRight size={16} />
            </Button>
          </div>
          {status && (
            <p className="text-sm text-ink/70">
              Оплачено <strong>{money(status.paid)}</strong> из {money(status.planned)}
              {status.overdueCount > 0 && <span className="ml-2 text-clay">· просрочено: {status.overdueCount}</span>}
            </p>
          )}
        </div>
        {status && status.planned > 0 && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-paper-dim">
            <div className="h-full bg-moss-500 transition-[width] duration-500" style={{ width: `${Math.min(100, (status.paid / status.planned) * 100)}%` }} />
          </div>
        )}
        <div className="mt-3 divide-y divide-line">
          {status?.items.map((n) => (
            <div key={n.needId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                {n.status === 'PAID' ? (
                  <CheckCircle2 size={16} className="shrink-0 text-moss-600" />
                ) : n.status === 'OVERDUE' ? (
                  <AlertCircle size={16} className="shrink-0 text-clay" />
                ) : (
                  <Clock size={16} className="shrink-0 text-ink/40" />
                )}
                <Link href={`/documents/financial_need/${n.needId}`} className="truncate hover:underline">
                  {n.name}
                </Link>
                {n.dueDate && <span className="text-xs text-ink/40">до {ruDate(n.dueDate)}</span>}
              </div>
              <div className="text-right">
                <span className={n.status === 'PAID' ? 'text-moss-600' : n.status === 'OVERDUE' ? 'text-clay' : ''}>
                  {n.status === 'PAID' ? money(n.paidAmount) : money(n.plannedAmount)}
                </span>
                <span className="ml-2 text-xs text-ink/50">{n.status === 'PAID' ? 'оплачено' : n.status === 'OVERDUE' ? 'просрочено' : 'ожидается'}</span>
              </div>
            </div>
          ))}
          {status && status.items.length === 0 && <p className="py-2 text-sm text-ink/50">Обязательных платежей пока нет — добавьте из найденных ниже.</p>}
        </div>
        <p className="mt-2 text-xs text-ink/40">
          Оплата находится по «тексту для поиска» в описании операции, а если его нет — по категории и сумме (±25%). Текст и день оплаты меняются в карточке платежа.
        </p>
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <Repeat size={16} className="text-ink/50" /> Найдено в истории
            </h2>
            {candidates && candidates.length > 0 && <p className="text-sm text-ink/60">Регулярные списания ≈ {money(subscriptionsMonthly)} в месяц</p>}
          </div>
          <label className="flex items-center gap-2 text-sm text-ink/60">
            <input type="checkbox" checked={showTracked} onChange={(e) => setShowTracked(e.target.checked)} /> показать уже отслеживаемые
          </label>
        </div>
        {candidates === null && <Loader2 size={16} className="mt-3 animate-spin text-ink/40" />}
        <div className="mt-2 divide-y divide-line">
          {visibleCandidates.map((c) => (
            <div key={c.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{c.label}</p>
                <p className="text-xs text-ink/50">
                  {PERIOD_LABEL[c.period]} · {c.occurrences} раз · последнее {ruDate(c.lastDate)} · следующее ≈ {ruDate(c.nextExpectedDate)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-clay">{money(c.averageAmount)}</span>
                {c.alreadyTracked ? (
                  <Badge tone="moss">отслеживается</Badge>
                ) : (
                  <Button variant="secondary" onClick={() => track(c)} disabled={busyKey === c.key}>
                    <Plus size={14} /> В обязательные
                  </Button>
                )}
              </div>
            </div>
          ))}
          {candidates && visibleCandidates.length === 0 && (
            <p className="py-2 text-sm text-ink/50">Новых регулярных платежей не найдено. Нужно хотя бы 3 списания с похожей суммой и регулярным интервалом.</p>
          )}
        </div>
      </Card>
    </AppShell>
  );
}
