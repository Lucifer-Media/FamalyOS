'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Badge } from '@/components/ui';
import { Upload, ArrowUpRight, ArrowDownLeft } from 'lucide-react';

interface AccountDetail {
  id: string;
  title: string;
  attributes: { bankName?: string; currency?: string; accountType?: string };
}

interface TransactionSummary {
  id: string;
  title: string;
  attributes: { date: string; amount: number; currency: string; description: string; category?: string };
}

interface StagedTransaction {
  date: string;
  amount: number;
  currency: string;
  description: string;
  counterparty?: string;
  category?: string;
  externalId: string;
  sourceFormat: string;
  isDuplicate: boolean;
}

export default function AccountDetailPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [staged, setStaged] = useState<StagedTransaction[] | null>(null);
  const [detectedFormat, setDetectedFormat] = useState('');
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [acc, txs] = await Promise.all([
      apiFetch<AccountDetail>(`/entities/${params.id}`),
      apiFetch<TransactionSummary[]>(`/entities?entityType=financial_transaction`),
    ]);
    setAccount(acc);
    // Показываем только операции этого счёта (фильтрация по attributes.accountId делается на клиенте,
    // т.к. общий список отдаётся по типу без фильтра по произвольному полю).
    setTransactions((txs as any).filter((t: any) => t.attributes?.accountId === params.id));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [params.id]);

  async function onUploadStatement(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await apiFetch<{ detectedFormat: string; warnings: string[]; transactions: StagedTransaction[] }>(
        `/finance/import/${params.id}/parse`,
        { method: 'POST', body: form, isForm: true },
      );
      setDetectedFormat(result.detectedFormat);
      setStaged(result.transactions);
      if (result.transactions.length === 0) {
        setError(result.warnings.join('; ') || 'В файле не найдено операций');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось разобрать файл выписки');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function onConfirmImport() {
    if (!staged) return;
    setConfirming(true);
    setError('');
    try {
      const toImport = staged.filter((t) => !t.isDuplicate);
      const result = await apiFetch<{ created: number; skippedDuplicates: number }>('/finance/import/confirm', {
        method: 'POST',
        body: { accountEntityId: params.id, transactions: toImport },
      });
      setStaged(null);
      await load();
      alert(`Импортировано операций: ${result.created}. Пропущено дублей: ${result.skippedDuplicates}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось подтвердить импорт');
    } finally {
      setConfirming(false);
    }
  }

  if (loading || !isAuthenticated) return null;

  const newCount = staged?.filter((t) => !t.isDuplicate).length ?? 0;
  const dupCount = staged?.filter((t) => t.isDuplicate).length ?? 0;

  return (
    <AppShell>
      <button onClick={() => router.push('/finance')} className="mb-3 text-sm text-ink/50 hover:underline">
        ← К списку счетов
      </button>

      {!account && !error && <p className="text-sm text-ink/50">Загрузка…</p>}
      <ErrorText>{error}</ErrorText>

      {account && (
        <>
          <div className="flex items-center justify-between">
            <h1 className="font-display text-xl font-semibold text-ink">{account.title}</h1>
            <div>
              <input ref={fileInputRef} type="file" accept=".ofx,.csv,.xlsx,.xls" className="hidden" onChange={onUploadStatement} />
              <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload size={16} /> {uploading ? 'Разбираем…' : 'Импортировать выписку'}
              </Button>
            </div>
          </div>

          {staged && (
            <Card className="mt-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold">Предпросмотр импорта</h2>
                <Badge tone="moss">{detectedFormat}</Badge>
              </div>
              <p className="mt-1 text-sm text-ink/60">
                Новых операций: <strong>{newCount}</strong>, уже импортировано ранее (пропускаются):{' '}
                <strong>{dupCount}</strong> из {staged.length} всего.
              </p>
              <div className="mt-3 max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {staged.slice(0, 200).map((t, i) => (
                      <tr key={i} className={t.isDuplicate ? 'opacity-40' : ''}>
                        <td className="py-1 pr-2 whitespace-nowrap">{t.date}</td>
                        <td className={`py-1 pr-2 text-right whitespace-nowrap ${t.amount < 0 ? 'text-clay' : 'text-moss-600'}`}>
                          {t.amount > 0 ? '+' : ''}
                          {t.amount} {t.currency}
                        </td>
                        <td className="py-1 pr-2 truncate">{t.description}</td>
                        <td className="py-1">{t.isDuplicate && <Badge tone="gold">дубль</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex gap-2">
                <Button onClick={onConfirmImport} disabled={confirming || newCount === 0}>
                  {confirming ? 'Импортируем…' : `Импортировать ${newCount} операций`}
                </Button>
                <Button variant="secondary" onClick={() => setStaged(null)}>
                  Отмена
                </Button>
              </div>
            </Card>
          )}

          <Card className="mt-4">
            <h2 className="font-display text-lg font-semibold">Операции</h2>
            <div className="mt-2 divide-y divide-line">
              {transactions
                .sort((a, b) => (a.attributes.date < b.attributes.date ? 1 : -1))
                .map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-2 text-sm">
                    <div className="flex items-center gap-2">
                      {t.attributes.amount < 0 ? (
                        <ArrowUpRight size={14} className="text-clay" />
                      ) : (
                        <ArrowDownLeft size={14} className="text-moss-600" />
                      )}
                      <div>
                        <p className="text-ink">{t.attributes.description}</p>
                        <p className="text-xs text-ink/40">
                          {t.attributes.date} {t.attributes.category ? `· ${t.attributes.category}` : ''}
                        </p>
                      </div>
                    </div>
                    <p className={t.attributes.amount < 0 ? 'text-clay' : 'text-moss-600'}>
                      {t.attributes.amount > 0 ? '+' : ''}
                      {t.attributes.amount} {t.attributes.currency}
                    </p>
                  </div>
                ))}
              {transactions.length === 0 && <p className="py-2 text-sm text-ink/50">Операций пока нет.</p>}
            </div>
          </Card>
        </>
      )}
    </AppShell>
  );
}
