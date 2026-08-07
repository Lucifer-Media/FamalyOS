'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeList, useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Badge } from '@/components/ui';
import { AlertTriangle, Check, X } from 'lucide-react';

interface IntakeDetail {
  intake: {
    id: string;
    status: string;
    suggestedEntityType: string | null;
    suggestedAttributes: Record<string, unknown> | null;
    suggestedConfidence: number | null;
  };
  ocr: {
    textSource: string;
    extractedText: string;
    confidence: number | null;
    errorMessage: string | null;
  } | null;
}

export default function DocumentIntakeDetailPage() {
  const { loading: authLoading, isAuthenticated } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<IntakeDetail | null>(null);
  const [entityType, setEntityType] = useState<string>('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { schemas } = useEntityTypeList();
  const { schema } = useEntityTypeSchema(entityType || null);

  useEffect(() => {
    apiFetch<IntakeDetail>(`/document-intake/${params.id}`)
      .then((d) => {
        setData(d);
        setEntityType(d.intake.suggestedEntityType ?? '');
        setValues(d.intake.suggestedAttributes ?? {});
      })
      .catch((e) => setError(e.message));
  }, [params.id]);

  useEffect(() => {
    if (!title && schema) {
      const nameish = (values.fullName ?? values.name ?? values.number) as string | undefined;
      setTitle(nameish ? `${schema.labelSingular}: ${nameish}` : schema.labelSingular);
    }
  }, [schema]);

  async function onConfirm() {
    if (!entityType) {
      setError('Выберите тип документа');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const entity = await apiFetch<{ id: string }>(`/document-intake/${params.id}/confirm`, {
        method: 'POST',
        body: { entityType, title, attributes: values },
      });
      router.push(`/documents/${entityType}/${entity.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setError(Array.isArray((e.body as any)?.errors) ? (e.body as any).errors.join('; ') : e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Не удалось подтвердить');
      }
      setBusy(false);
    }
  }

  async function onReject() {
    if (!confirm('Отклонить этот документ? Файл останется в хранилище, но карточка не будет создана.')) return;
    await apiFetch(`/document-intake/${params.id}/reject`, { method: 'POST' });
    router.push('/document-intake');
  }

  if (authLoading || !isAuthenticated) return null;

  return (
    <AppShell>
      <button onClick={() => router.push('/document-intake')} className="mb-3 text-sm text-ink/50 hover:underline">
        ← К списку загрузок
      </button>

      <h1 className="font-display text-2xl font-semibold text-ink">Подтверждение документа</h1>

      <ErrorText>{error}</ErrorText>

      {data && (
        <>
          <Card className="mt-4">
            <h2 className="font-display text-lg font-semibold">Распознанный текст (OCR)</h2>
            {data.ocr?.errorMessage && (
              <p className="mt-2 flex items-start gap-2 rounded-card bg-clay/10 px-3 py-2 text-sm text-clay">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {data.ocr.errorMessage}
              </p>
            )}
            {data.ocr?.extractedText && (
              <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-card bg-paper-dim p-3 font-mono text-xs text-ink/70">
                {data.ocr.extractedText}
              </pre>
            )}
            <p className="mt-2 text-xs text-ink/40">
              Источник: {data.ocr?.textSource === 'embedded_pdf_text' ? 'текстовый слой PDF' : 'OCR (Tesseract)'}
              {data.ocr?.confidence != null && ` · уверенность OCR ~${Math.round(data.ocr.confidence * 100)}%`}
            </p>
          </Card>

          <Card className="mt-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Тип документа</h2>
              {data.intake.suggestedConfidence != null && (
                <Badge tone={data.intake.suggestedConfidence >= 0.8 ? 'moss' : 'gold'}>
                  Предположение конвейера, уверенность ~{Math.round(data.intake.suggestedConfidence * 100)}%
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-ink/50">
              Это ТОЛЬКО предположение — проверьте и при необходимости исправьте тип и поля ниже
              перед сохранением.
            </p>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="mt-3 w-full rounded-card border border-line bg-white px-3 py-2 text-sm"
            >
              <option value="">— выберите тип —</option>
              {schemas.map((s) => (
                <option key={s.entityType} value={s.entityType}>
                  {s.labelSingular}
                </option>
              ))}
            </select>
          </Card>

          {schema && (
            <Card className="mt-4">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Название записи"
                className="mb-3 w-full rounded-card border border-line bg-white px-3 py-2 text-sm font-medium"
              />
              <DynamicEntityForm
                schema={schema}
                values={values}
                onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
              />
            </Card>
          )}

          <div className="mt-4 flex gap-2">
            <Button onClick={onConfirm} disabled={busy || !entityType}>
              <Check size={16} /> Подтвердить и создать карточку
            </Button>
            <Button variant="secondary" onClick={onReject}>
              <X size={16} /> Отклонить
            </Button>
          </div>
        </>
      )}
    </AppShell>
  );
}
