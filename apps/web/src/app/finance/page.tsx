'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Badge } from '@/components/ui';
import { Plus, Wallet } from 'lucide-react';

interface AccountSummary {
  id: string;
  title: string;
  attributes: { bankName?: string; accountType?: string; currency?: string };
}

export default function FinancePage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { schema } = useEntityTypeSchema('bank_account');
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');

  async function load() {
    const data = await apiFetch<AccountSummary[]>('/entities?entityType=bank_account');
    setAccounts(data);
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
        body: { entityType: 'bank_account', title, attributes: values },
      });
      setCreating(false);
      setValues({});
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось создать счёт');
    }
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Финансы</h1>
          <p className="mt-1 text-sm text-ink/60">Счета, операции, импорт выписок и сверка с ЖКХ.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/finance/budgets">
            <Button variant="secondary">Бюджеты</Button>
          </Link>
          <Link href="/finance/analytics">
            <Button variant="secondary">Аналитика</Button>
          </Link>
          <Button onClick={() => setCreating((v) => !v)} disabled={!schema}>
            <Plus size={16} /> Добавить счёт
          </Button>
        </div>
      </div>

      {!schema && !error && <p className="mt-4 text-sm text-ink/50">Загрузка…</p>}
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

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((acc) => (
          <Link key={acc.id} href={`/finance/accounts/${acc.id}`}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <div className="flex items-center gap-2">
                <Wallet size={16} className="text-ink/40" />
                <p className="font-medium text-ink">{acc.title}</p>
              </div>
              {acc.attributes.currency && <Badge tone="default">{acc.attributes.currency}</Badge>}
            </Card>
          </Link>
        ))}
        {accounts.length === 0 && !creating && <p className="text-sm text-ink/50">Счетов пока нет.</p>}
      </div>
    </AppShell>
  );
}
