'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText } from '@/components/ui';
import { Plus } from 'lucide-react';

interface EntitySummary {
  id: string;
  title: string;
  currentVersion: number;
}

export default function PassportRfListPage() {
  const { loading: authLoading, isAuthenticated } = useRequireAuth();
  const router = useRouter();
  const { schema } = useEntityTypeSchema('passport_rf');
  const [items, setItems] = useState<EntitySummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<EntitySummary[]>('/entities?entityType=passport_rf').then(setItems).catch((e) => setError(e.message));
  }, []);

  async function onCreate() {
    setBusy(true);
    setError('');
    try {
      const created = await apiFetch<EntitySummary>('/documents/passport-rf', {
        method: 'POST',
        body: { attributes: values },
      });
      router.push(`/documents/passport-rf/${created.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setError(Array.isArray((e.body as any)?.errors) ? (e.body as any).errors.join('; ') : e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Не удалось создать');
      }
      setBusy(false);
    }
  }

  if (authLoading || !isAuthenticated || !schema) return null;

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">Паспорта РФ</h1>
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus size={16} /> Добавить паспорт
        </Button>
      </div>

      {creating && (
        <Card className="mt-4">
          <DynamicEntityForm schema={schema} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
          <ErrorText>{error}</ErrorText>
          <div className="mt-3 flex gap-2">
            <Button onClick={onCreate} disabled={busy}>
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <Link key={item.id} href={`/documents/passport-rf/${item.id}`}>
            <Card className="hover:shadow-md">
              <p className="font-medium text-ink">{item.title}</p>
            </Card>
          </Link>
        ))}
        {items.length === 0 && !creating && <p className="text-sm text-ink/50">Паспортов пока нет.</p>}
      </div>
    </AppShell>
  );
}
