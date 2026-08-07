'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText } from '@/components/ui';
import { Plus, Save } from 'lucide-react';

interface EntityDetail {
  id: string;
  title: string;
  currentVersion: number;
  attributes: Record<string, unknown>;
}

interface ChildRecord {
  id: string;
  entityType: string;
  title: string;
  attributes: Record<string, unknown>;
}

const CHILD_TYPE_LABELS: Record<string, string> = {
  passport_registration: 'Регистрации (прописка)',
  passport_marriage: 'Записи о браке',
  passport_child_record: 'Записи о детях',
};

export default function PassportRfDetailPage() {
  const { loading: authLoading, isAuthenticated } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { schema } = useEntityTypeSchema('passport_rf');
  const [passport, setPassport] = useState<EntityDetail | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [children, setChildren] = useState<ChildRecord[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [addingType, setAddingType] = useState<string | null>(null);
  const [childValues, setChildValues] = useState<Record<string, unknown>>({});

  async function load() {
    const [p, c] = await Promise.all([
      apiFetch<EntityDetail>(`/documents/passport-rf/${params.id}`),
      apiFetch<ChildRecord[]>(`/documents/passport-rf/${params.id}/child-records`),
    ]);
    setPassport(p);
    setValues(p.attributes ?? {});
    setChildren(c);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [params.id]);

  async function onSave() {
    setSaving(true);
    setError('');
    try {
      const updated = await apiFetch<EntityDetail>(`/documents/passport-rf/${params.id}`, {
        method: 'PATCH',
        body: { attributes: values },
      });
      setPassport(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  async function onAddChild(childType: string) {
    try {
      await apiFetch(`/documents/passport-rf/${params.id}/child-records`, {
        method: 'POST',
        body: { childType, attributes: childValues },
      });
      setAddingType(null);
      setChildValues({});
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось добавить запись');
    }
  }

  if (authLoading || !isAuthenticated || !schema) return null;

  const grouped = ['passport_registration', 'passport_marriage', 'passport_child_record'].map((type) => ({
    type,
    label: CHILD_TYPE_LABELS[type],
    items: children.filter((c) => c.entityType === type),
  }));

  return (
    <AppShell>
      <button onClick={() => router.push('/documents/passport-rf')} className="mb-3 text-sm text-ink/50 hover:underline">
        ← К списку паспортов
      </button>

      {!passport && !error && <p className="text-sm text-ink/50">Загрузка…</p>}
      <ErrorText>{error}</ErrorText>

      {passport && (
        <>
          <div className="flex items-center justify-between">
            <h1 className="font-display text-xl font-semibold text-ink">{passport.title}</h1>
            <Button onClick={onSave} disabled={saving}>
              <Save size={16} /> {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </div>

          <Card className="mt-4">
            <DynamicEntityForm schema={schema} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
          </Card>

          {grouped.map((group) => (
            <div key={group.type} className="mt-6">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold text-ink">{group.label}</h2>
                <Button
                  variant="secondary"
                  onClick={() => setAddingType(addingType === group.type ? null : group.type)}
                >
                  <Plus size={14} /> Добавить
                </Button>
              </div>

              {addingType === group.type && (
                <ChildRecordForm
                  childType={group.type}
                  values={childValues}
                  onChange={(k, v) => setChildValues((s) => ({ ...s, [k]: v }))}
                  onSubmit={() => onAddChild(group.type)}
                  onCancel={() => setAddingType(null)}
                />
              )}

              <div className="mt-2 space-y-2">
                {group.items.map((item) => (
                  <Card key={item.id}>
                    <p className="text-sm text-ink">{item.title}</p>
                  </Card>
                ))}
                {group.items.length === 0 && addingType !== group.type && (
                  <p className="text-xs text-ink/40">Пока нет записей.</p>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </AppShell>
  );
}

function ChildRecordForm({
  childType,
  values,
  onChange,
  onSubmit,
  onCancel,
}: {
  childType: string;
  values: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { schema } = useEntityTypeSchema(childType);
  if (!schema) return null;
  return (
    <Card className="mt-2">
      <DynamicEntityForm schema={schema} values={values} onChange={onChange} />
      <div className="mt-3 flex gap-2">
        <Button onClick={onSubmit}>Сохранить</Button>
        <Button variant="secondary" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </Card>
  );
}
