'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText } from '@/components/ui';
import { History, Save } from 'lucide-react';

interface EntityDetail {
  id: string;
  title: string;
  currentVersion: number;
  attributes: Record<string, unknown>;
  confidentialityLevel: string;
}

interface VersionEntry {
  versionNumber: number;
  action: string;
  changeSummary: string | null;
  changedAt: string;
}

export default function EntityDetailPage() {
  const { loading: authLoading, isAuthenticated } = useRequireAuth();
  const params = useParams<{ type: string; id: string }>();
  const router = useRouter();
  const { schema } = useEntityTypeSchema(params.type);
  const [entity, setEntity] = useState<EntityDetail | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const data = await apiFetch<EntityDetail>(`/entities/${params.id}`);
    setEntity(data);
    setValues(data.attributes ?? {});
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [params.id]);

  async function onSave() {
    setSaving(true);
    setError('');
    try {
      const updated = await apiFetch<EntityDetail>(`/entities/${params.id}`, {
        method: 'PATCH',
        body: { attributes: values },
      });
      setEntity(updated);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setError(Array.isArray((e.body as any)?.errors) ? (e.body as any).errors.join('; ') : e.message);
      } else if (e instanceof ApiError && e.status === 403) {
        setError('У вас нет прав на редактирование этой записи.');
      } else {
        setError(e instanceof Error ? e.message : 'Не удалось сохранить');
      }
    } finally {
      setSaving(false);
    }
  }

  async function loadVersions() {
    const v = await apiFetch<VersionEntry[]>(`/entities/${params.id}/versions`);
    setVersions(v);
    setShowVersions(true);
  }

  async function onRevert(versionNumber: number) {
    if (!confirm(`Откатить к версии ${versionNumber}?`)) return;
    const updated = await apiFetch<EntityDetail>(`/entities/${params.id}/revert`, {
      method: 'POST',
      body: { versionNumber },
    });
    setEntity(updated);
    setValues(updated.attributes ?? {});
    await loadVersions();
  }

  if (authLoading || !isAuthenticated) return null;

  return (
    <AppShell>
      <button onClick={() => router.push(`/documents/${params.type}`)} className="mb-3 text-sm text-ink/50 hover:underline">
        ← Назад к списку
      </button>

      {!entity && !error && <p className="text-sm text-ink/50">Загрузка…</p>}
      <ErrorText>{error}</ErrorText>

      {entity && schema && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="font-display text-xl font-semibold text-ink">{entity.title}</h1>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={loadVersions}>
                <History size={16} /> Версии (v{entity.currentVersion})
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
              <h3 className="font-display text-lg font-semibold">История версий</h3>
              <ul className="mt-2 divide-y divide-line">
                {versions.map((v) => (
                  <li key={v.versionNumber} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <span className="font-medium">v{v.versionNumber}</span> — {v.action} ·{' '}
                      <span className="text-ink/50">{new Date(v.changedAt).toLocaleString('ru-RU')}</span>
                    </div>
                    {v.versionNumber !== entity.currentVersion && (
                      <Button variant="secondary" onClick={() => onRevert(v.versionNumber)}>
                        Откатить
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}
