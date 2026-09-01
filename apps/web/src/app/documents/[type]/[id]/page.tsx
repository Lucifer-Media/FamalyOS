'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { apiFetch, ApiError, getAccessToken, getCurrentFamilySpaceId } from '@/lib/api';
import { Button, Card, ErrorText } from '@/components/ui';
import { History, Save, Paperclip, Download, ScanLine, Archive, ArchiveRestore } from 'lucide-react';
import { UtilityBillPanels } from '@/components/utility-bill-panels';
import { toast } from 'sonner';

interface AttachedFile {
  fileId: string;
  relationRole: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

interface EntityDetail {
  id: string;
  title: string;
  status: string;
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
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const reprocessInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [data, attachedFiles] = await Promise.all([
      apiFetch<EntityDetail>(`/entities/${params.id}`),
      apiFetch<AttachedFile[]>(`/entities/${params.id}/files`),
    ]);
    setEntity(data);
    setValues(data.attributes ?? {});
    setFiles(attachedFiles);
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

  async function onToggleArchive() {
    if (!entity) return;
    setArchiveBusy(true);
    try {
      const nextAction = entity.status === 'ARCHIVED' ? 'unarchive' : 'archive';
      const updated = await apiFetch<EntityDetail>(`/entities/${params.id}/${nextAction}`, { method: 'PATCH' });
      setEntity(updated);
      toast.success(nextAction === 'archive' ? 'Запись архивирована' : 'Запись восстановлена из архива');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Не удалось изменить статус записи');
    } finally {
      setArchiveBusy(false);
    }
  }

  async function onReprocessFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReprocessing(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const uploaded = await apiFetch<{ id: string }>('/files', { method: 'POST', body: form, isForm: true });
      const { intake } = await apiFetch<{ intake: { id: string } }>(
        `/document-intake/from-file/${uploaded.id}?targetEntityId=${params.id}`,
        { method: 'POST' },
      );
      router.push(`/document-intake/${intake.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось обработать документ');
      setReprocessing(false);
    } finally {
      if (reprocessInputRef.current) reprocessInputRef.current.value = '';
    }
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
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold text-ink">{entity.title}</h1>
              {entity.status === 'ARCHIVED' && (
                <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold">В архиве</span>
              )}
            </div>
            <div className="flex gap-2">
              <input ref={reprocessInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={onReprocessFile} />
              <Button variant="secondary" onClick={() => reprocessInputRef.current?.click()} disabled={reprocessing}>
                <ScanLine size={16} /> {reprocessing ? 'Обрабатываем…' : 'Переснять/переобработать'}
              </Button>
              <Button variant="secondary" onClick={loadVersions}>
                <History size={16} /> Версии (v{entity.currentVersion})
              </Button>
              <Button variant="secondary" onClick={onToggleArchive} disabled={archiveBusy}>
                {entity.status === 'ARCHIVED' ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                {entity.status === 'ARCHIVED' ? 'Восстановить' : 'Архивировать'}
              </Button>
              <Button onClick={onSave} disabled={saving}>
                <Save size={16} /> {saving ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </div>

          <Card className="mt-4">
            <DynamicEntityForm schema={schema} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
          </Card>

          {params.type === 'utility_bill' && (
            <UtilityBillPanels billId={params.id} billDate={values.dueDate as string | undefined} />
          )}

          {files.length > 0 && (
            <Card className="mt-4">
              <h3 className="font-display text-lg font-semibold">Прикреплённые файлы</h3>
              <ul className="mt-2 divide-y divide-line">
                {files.map((f) => (
                  <li key={f.fileId} className="flex items-center justify-between py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Paperclip size={14} className="text-ink/40" />
                      {f.originalName}
                      <span className="text-xs text-ink/40">({f.relationRole})</span>
                    </span>
                    <button
                      onClick={() => downloadFile(f.fileId, f.originalName)}
                      className="flex items-center gap-1 text-moss-600 hover:underline"
                    >
                      <Download size={14} /> Скачать
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

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

async function downloadFile(fileId: string, originalName: string) {
  const token = getAccessToken();
  const spaceId = getCurrentFamilySpaceId();
  const res = await fetch(`/api/files/${fileId}/download`, {
    headers: { Authorization: `Bearer ${token}`, ...(spaceId ? { 'X-Family-Space-Id': spaceId } : {}) },
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = originalName;
  a.click();
  URL.revokeObjectURL(url);
}
