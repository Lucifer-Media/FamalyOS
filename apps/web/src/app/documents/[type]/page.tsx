'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  updatedAt: string;
}

export default function EntityTypeListPage() {
  const { loading: authLoading, isAuthenticated } = useRequireAuth();
  const params = useParams<{ type: string }>();
  const router = useRouter();
  const { schema, loading: schemaLoading } = useEntityTypeSchema(params.type);
  const [items, setItems] = useState<EntitySummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await apiFetch<EntitySummary[]>(`/entities?entityType=${params.type}`);
    setItems(data);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [params.type]);

  async function onCreate() {
    if (!schema) return;
    setBusy(true);
    setError('');
    try {
      const title = buildTitle(schema.labelSingular, values);
      const created = await apiFetch<EntitySummary>('/entities', {
        method: 'POST',
        body: { entityType: params.type, title, attributes: values },
      });
      router.push(`/documents/${params.type}/${created.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setError(Array.isArray((e.body as any)?.errors) ? (e.body as any).errors.join('; ') : e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Не удалось создать запись');
      }
      setBusy(false);
    }
  }

  if (authLoading || !isAuthenticated) return null;
  if (schemaLoading) return <AppShell><p className="text-sm text-ink/50">Загрузка…</p></AppShell>;
  if (!schema) return <AppShell><p className="text-sm text-clay">Неизвестный тип записи.</p></AppShell>;

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">{schema.labelPlural}</h1>
        </div>
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus size={16} /> Добавить
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
          <Link key={item.id} href={`/documents/${params.type}/${item.id}`}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <p className="font-medium text-ink">{item.title}</p>
              <p className="mt-1 text-xs text-ink/40">
                v{item.currentVersion} · {new Date(item.updatedAt).toLocaleDateString('ru-RU')}
              </p>
            </Card>
          </Link>
        ))}
        {items.length === 0 && !creating && (
          <p className="text-sm text-ink/50">Записей пока нет.</p>
        )}
      </div>
    </AppShell>
  );
}

function buildTitle(labelSingular: string, values: Record<string, unknown>): string {
  const nameish = (values.fullName ?? values.name ?? values.service ?? values.model ?? values.address) as
    | string
    | undefined;
  return nameish ? `${labelSingular}: ${nameish}` : labelSingular;
}
