'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText } from '@/components/ui';
import { toast } from 'sonner';

interface TxLite {
  id: string;
  attributes: { accountId?: string };
}

interface AccountLite {
  id: string;
  title: string;
}

/**
 * Раньше архивирование счёта не трогало его операции — они оставались
 * ACTIVE и продолжали попадать в аналитику/бюджеты, хотя счёт уже в
 * архиве (реальный баг из отчёта пользователя). Теперь при архивировании
 * счёта с активными операциями система явно спрашивает: архивировать
 * операции вместе со счётом или перенести их на другой счёт — молчаливого
 * "зависания" операций больше не происходит.
 */
export default function ArchiveAccountDialog({
  accountId,
  accountTitle,
  otherAccounts,
  onDone,
  onCancel,
}: {
  accountId: string;
  accountTitle: string;
  otherAccounts: AccountLite[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<TxLite[]>([]);
  const [mode, setMode] = useState<'archive' | 'move'>('archive');
  const [targetAccountId, setTargetAccountId] = useState<string>(otherAccounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<TxLite[]>('/entities?entityType=financial_transaction&status=ACTIVE')
      .then((all) => setTransactions(all.filter((t) => t.attributes.accountId === accountId)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [accountId]);

  async function onConfirm() {
    setBusy(true);
    setError('');
    try {
      if (transactions.length > 0) {
        if (mode === 'archive') {
          for (const t of transactions) {
            await apiFetch(`/entities/${t.id}/archive`, { method: 'PATCH' });
          }
        } else {
          if (!targetAccountId) {
            setError('Выберите счёт, на который перенести операции');
            setBusy(false);
            return;
          }
          for (const t of transactions) {
            await apiFetch(`/entities/${t.id}`, { method: 'PATCH', body: { attributes: { accountId: targetAccountId } } });
          }
        }
      }
      await apiFetch(`/entities/${accountId}/archive`, { method: 'PATCH' });
      toast.success(
        transactions.length === 0
          ? 'Счёт архивирован'
          : mode === 'archive'
            ? `Счёт и ${transactions.length} операций архивированы`
            : `Счёт архивирован, ${transactions.length} операций перенесено`,
      );
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось завершить архивирование');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="animate-in mt-4">
      <h2 className="font-display text-lg font-semibold">Архивировать «{accountTitle}»</h2>
      {loading && <p className="mt-2 text-sm text-ink/50">Проверяем операции по счёту…</p>}

      {!loading && transactions.length === 0 && (
        <p className="mt-2 text-sm text-ink/60">У счёта нет активных операций — можно архивировать сразу.</p>
      )}

      {!loading && transactions.length > 0 && (
        <>
          <p className="mt-2 text-sm text-ink/60">
            На этом счёте <strong>{transactions.length}</strong> активных операций. Что с ними сделать?
          </p>
          <div className="mt-3 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={mode === 'archive'} onChange={() => setMode('archive')} />
              Архивировать операции вместе со счётом
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={mode === 'move'} onChange={() => setMode('move')} disabled={otherAccounts.length === 0} />
              Перенести операции на другой счёт
              {otherAccounts.length === 0 && <span className="text-xs text-ink/40">(нет других счетов)</span>}
            </label>
            {mode === 'move' && (
              <select
                value={targetAccountId}
                onChange={(e) => setTargetAccountId(e.target.value)}
                className="ml-6 rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
              >
                {otherAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        </>
      )}

      <ErrorText>{error}</ErrorText>

      <div className="mt-4 flex gap-2">
        <Button onClick={onConfirm} disabled={loading || busy}>
          {busy ? 'Выполняем…' : 'Подтвердить архивирование'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
      </div>
    </Card>
  );
}
