'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { FinanceSubNav } from '@/components/finance-subnav';
import { apiFetch } from '@/lib/api';
import { Button, Card, ErrorText } from '@/components/ui';
import { money, ruDate, inputClass } from '@/lib/finance-format';
import { toast } from 'sonner';
import { Eraser, Eye, AlertTriangle } from 'lucide-react';

interface Named {
  id: string;
  title: string;
}
interface Preview {
  count: number;
  firstDate: string | null;
  lastDate: string | null;
  byAccount: { accountId: string; count: number }[];
  sample: { id: string; date: string; amount: number; description?: string }[];
}

/**
 * Очистка тестовых операций — массовое АРХИВИРОВАНИЕ (обратимо), в духе
 * правила проекта «удаления нет». Физическое удаление — только разовым
 * скриптом ops/purge-test-finance.sh на сервере.
 */
export default function FinanceCleanupPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const [accounts, setAccounts] = useState<Named[]>([]);
  const [filter, setFilter] = useState({ all: false, accountId: '', source: '', dateFrom: '', dateTo: '' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthenticated) apiFetch<Named[]>('/entities?entityType=bank_account').then(setAccounts).catch((e) => setError(e.message));
  }, [isAuthenticated]);

  const accountName = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a.title])), [accounts]);
  const body = () => ({
    all: filter.all || undefined,
    accountId: filter.accountId || undefined,
    source: filter.source || undefined,
    dateFrom: filter.dateFrom || undefined,
    dateTo: filter.dateTo || undefined,
  });

  async function runPreview() {
    setBusy(true);
    setError('');
    setConfirmText('');
    try {
      setPreview(await apiFetch<Preview>('/finance/cleanup/preview', { method: 'POST', body: body() }));
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ archived: number }>('/finance/cleanup/archive', { method: 'POST', body: { ...body(), confirmCount: preview.count } });
      toast.success(`В архив перенесено операций: ${res.archived}`);
      setPreview(null);
      setConfirmText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading || !isAuthenticated) return null;
  const set = (patch: Partial<typeof filter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setPreview(null);
  };

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold text-ink">Очистка тестовых операций</h1>
      <p className="mt-1 text-sm text-ink/60">
        Операции переносятся в архив: они исчезают из аналитики, бюджетов, отчётов и не мешают заново импортировать те же выписки. Вернуть можно из карточки операции.
      </p>
      <div className="mt-4">
        <FinanceSubNav active="/finance/transactions" />
      </div>
      <ErrorText>{error}</ErrorText>

      <Card className="mt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={filter.all} onChange={(e) => set({ all: e.target.checked })} /> Все операции (без фильтра)
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Счёт</span>
            <select className={inputClass} value={filter.accountId} onChange={(e) => set({ accountId: e.target.value })}>
              <option value="">— любой —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Как заведены</span>
            <select className={inputClass} value={filter.source} onChange={(e) => set({ source: e.target.value })}>
              <option value="">— любые —</option>
              <option value="MANUAL">Вручную</option>
              <option value="IMPORT">Импорт выписки</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Дата операции с</span>
            <input type="date" className={inputClass} value={filter.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">по</span>
            <input type="date" className={inputClass} value={filter.dateTo} onChange={(e) => set({ dateTo: e.target.value })} />
          </label>
        </div>
        <Button className="mt-3" variant="secondary" onClick={runPreview} disabled={busy}>
          <Eye size={16} /> Показать, что попадёт
        </Button>
      </Card>

      {preview && (
        <Card className="animate-in mt-4">
          <p className="font-display text-lg font-semibold">
            {preview.count} операций{preview.firstDate && ` · ${ruDate(preview.firstDate)} — ${ruDate(preview.lastDate)}`}
          </p>
          <div className="mt-2 text-sm text-ink/70">
            {preview.byAccount.map((b) => (
              <p key={b.accountId}>
                {accountName[b.accountId] ?? 'Счёт не найден'}: {b.count}
              </p>
            ))}
          </div>
          <div className="mt-3 max-h-56 divide-y divide-line overflow-y-auto text-sm">
            {preview.sample.map((s) => (
              <div key={s.id} className="flex justify-between gap-2 py-1">
                <span className="truncate">
                  {ruDate(s.date)} · {s.description ?? '—'}
                </span>
                <span className="shrink-0">{money(s.amount)}</span>
              </div>
            ))}
            {preview.count > preview.sample.length && <p className="py-1 text-xs text-ink/50">…и ещё {preview.count - preview.sample.length}</p>}
          </div>
          {preview.count > 0 && (
            <div className="mt-4 rounded-card border border-clay/40 bg-clay/5 p-3">
              <p className="flex items-start gap-2 text-sm">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-clay" /> Для подтверждения введите количество операций: <strong>{preview.count}</strong>
              </p>
              <div className="mt-2 flex gap-2">
                <input className={`${inputClass} w-32`} inputMode="numeric" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
                <Button variant="danger" onClick={archive} disabled={busy || confirmText !== String(preview.count)}>
                  <Eraser size={16} /> В архив
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </AppShell>
  );
}
