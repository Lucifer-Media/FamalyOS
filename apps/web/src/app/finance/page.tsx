'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { FinanceSubNav } from '@/components/finance-subnav';
import { BankAvatar } from '@/components/bank-avatar';
import PersonSelect, { usePeople } from '@/components/ui/person-select';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Badge } from '@/components/ui';
import { toast } from 'sonner';
import { Plus, Archive, ArchiveRestore } from 'lucide-react';

interface AccountSummary {
  id: string;
  title: string;
  status: string;
  ownerPersonId?: string | null;
  attributes: {
    bankId?: string;
    bankName?: string;
    brandColorOverride?: string;
    accountType?: string;
    currency?: string;
    currentBalance?: number;
  };
}

interface BankSummary {
  id: string;
  attributes: { name?: string; brandColor?: string };
}

export default function FinancePage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { schema } = useEntityTypeSchema('bank_account');
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [banks, setBanks] = useState<Record<string, BankSummary>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ownerPersonId, setOwnerPersonId] = useState<string | undefined>(undefined);
  const people = usePeople();

  async function load() {
    const [active, archived, bankList] = await Promise.all([
      apiFetch<AccountSummary[]>('/entities?entityType=bank_account&status=ACTIVE'),
      apiFetch<AccountSummary[]>('/entities?entityType=bank_account&status=ARCHIVED'),
      apiFetch<BankSummary[]>('/entities?entityType=bank'),
    ]);
    setAccounts([...active, ...archived]);
    setBanks(Object.fromEntries(bankList.map((b) => [b.id, b])));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function onCreate() {
    if (!schema) return;
    setError('');
    try {
      const title = `${values.bankName ?? 'Счёт'} (${values.accountType ?? ''})`;
      await apiFetch('/entities', {
        method: 'POST',
        body: { entityType: 'bank_account', title, attributes: values, ownerPersonId },
      });
      setCreating(false);
      setValues({});
      setOwnerPersonId(undefined);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось создать счёт');
    }
  }

  async function onToggleArchive(acc: AccountSummary, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusyId(acc.id);
    try {
      const nextAction = acc.status === 'ARCHIVED' ? 'unarchive' : 'archive';
      await apiFetch(`/entities/${acc.id}/${nextAction}`, { method: 'PATCH' });
      toast.success(nextAction === 'archive' ? 'Счёт архивирован' : 'Счёт восстановлен из архива');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Не удалось изменить статус счёта');
    } finally {
      setBusyId(null);
    }
  }

  if (loading || !isAuthenticated) return null;

  const visibleAccounts = accounts.filter((a) => showArchived || a.status !== 'ARCHIVED');

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Финансы</h1>
          <p className="mt-1 text-sm text-ink/60">Счета, операции, импорт выписок и сверка с ЖКХ.</p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} disabled={!schema}>
          <Plus size={16} /> Добавить счёт
        </Button>
      </div>

      <div className="mt-4">
        <FinanceSubNav active="/finance" />
      </div>

      {!schema && !error && <p className="mt-4 text-sm text-ink/50">Загрузка…</p>}
      <ErrorText>{error}</ErrorText>

      {creating && schema && (
        <Card className="animate-in mt-4">
          <DynamicEntityForm schema={schema} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
          <div className="mt-3">
            <label className="mb-1 block text-xs text-ink/50">Владелец счёта (участник семьи)</label>
            <PersonSelect value={ownerPersonId} onChange={setOwnerPersonId} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={onCreate}>Сохранить</Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}

      <div className="mt-6 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">Счета</h2>
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

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibleAccounts.map((acc) => {
          const bank = acc.attributes.bankId ? banks[acc.attributes.bankId] : undefined;
          const bankName = bank?.attributes.name ?? acc.attributes.bankName;
          const brandColor = acc.attributes.brandColorOverride ?? bank?.attributes.brandColor;
          return (
            <Link key={acc.id} href={`/finance/accounts/${acc.id}`}>
              <Card
                className={`h-full transition-shadow hover:shadow-md ${acc.status === 'ARCHIVED' ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <BankAvatar bankName={bankName} brandColor={brandColor} />
                    <div>
                      <p className="font-medium text-ink">{acc.title}</p>
                      {typeof acc.attributes.currentBalance === 'number' && (
                        <p className="text-sm text-ink/60">
                          {acc.attributes.currentBalance.toLocaleString('ru-RU')} {acc.attributes.currency}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => onToggleArchive(acc, e)}
                    disabled={busyId === acc.id}
                    title={acc.status === 'ARCHIVED' ? 'Восстановить из архива' : 'Архивировать'}
                    className="shrink-0 rounded-card p-1.5 text-ink/40 hover:bg-paper-dim hover:text-ink"
                  >
                    {acc.status === 'ARCHIVED' ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {acc.attributes.currency && <Badge tone="default">{acc.attributes.currency}</Badge>}
                  {acc.ownerPersonId && (
                    <Badge tone="default">{people.find((p) => p.id === acc.ownerPersonId)?.fullName ?? 'Участник'}</Badge>
                  )}
                  {acc.status === 'ARCHIVED' && <Badge tone="gold">В архиве</Badge>}
                </div>
              </Card>
            </Link>
          );
        })}
        {visibleAccounts.length === 0 && !creating && <p className="text-sm text-ink/50">Счетов пока нет.</p>}
      </div>
    </AppShell>
  );
}
