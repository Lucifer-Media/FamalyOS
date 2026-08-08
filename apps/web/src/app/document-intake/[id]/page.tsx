'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeList, useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Badge } from '@/components/ui';
import { AlertTriangle, Check, X, RefreshCw, Copy, Loader2 } from 'lucide-react';

interface FieldConflict {
  field: string;
  currentValue: unknown;
  suggestedValue: unknown;
  suggestedConfidence?: number;
}

interface IntakeDetail {
  intake: {
    id: string;
    status: string;
    suggestedEntityType: string | null;
    suggestedAttributes: Record<string, unknown> | null;
    suggestedFieldConfidence: Record<string, number> | null;
    suggestedConfidence: number | null;
    targetEntityId: string | null;
    possibleDuplicateOfEntityId: string | null;
  };
  ocr: {
    textSource: string;
    extractedText: string;
    confidence: number | null;
    errorMessage: string | null;
  } | null;
  fieldConflicts?: FieldConflict[];
}

export default function DocumentIntakeDetailPage() {
  const { loading: authLoading, isAuthenticated } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const parentEntityId = searchParams.get('parentEntityId') ?? undefined;
  const router = useRouter();
  const [data, setData] = useState<IntakeDetail | null>(null);
  const [entityType, setEntityType] = useState<string>('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [conflictChoices, setConflictChoices] = useState<Record<string, 'current' | 'suggested'>>({});
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { schemas } = useEntityTypeList();
  const { schema } = useEntityTypeSchema(entityType || null);

  async function load() {
    const d = await apiFetch<IntakeDetail>(`/document-intake/${params.id}`);
    setData(d);
    setEntityType(d.intake.suggestedEntityType ?? '');
    setValues(d.intake.suggestedAttributes ?? {});
    if (d.fieldConflicts?.length) {
      // По умолчанию — сохраняем текущее значение (никогда не перезаписываем
      // подтверждённые данные молча), пользователь явно выбирает "принять новое".
      const defaults: Record<string, 'current' | 'suggested'> = {};
      for (const c of d.fieldConflicts) defaults[c.field] = 'current';
      setConflictChoices(defaults);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [params.id]);

  // Пока документ в очереди — периодически проверяем, не завершилась ли обработка.
  useEffect(() => {
    if (data?.intake.status !== 'PROCESSING') return;
    const timer = setInterval(() => load().catch(() => undefined), 2000);
    return () => clearInterval(timer);
  }, [data?.intake.status, params.id]);

  useEffect(() => {
    if (!title && schema) {
      const nameish = (values.fullName ?? values.name ?? values.number) as string | undefined;
      setTitle(nameish ? `${schema.labelSingular}: ${nameish}` : schema.labelSingular);
    }
  }, [schema]);

  function resolvedValues(): Record<string, unknown> {
    if (!data?.fieldConflicts?.length) return values;
    const resolved = { ...values };
    for (const c of data.fieldConflicts) {
      resolved[c.field] = conflictChoices[c.field] === 'suggested' ? c.suggestedValue : c.currentValue;
    }
    return resolved;
  }

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
        body: { entityType, title, attributes: resolvedValues(), parentEntityId },
      });
      router.push(entityType === 'passport_rf' ? `/documents/passport-rf/${entity.id}` : `/documents/${entityType}/${entity.id}`);
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

  async function onRetry() {
    setBusy(true);
    try {
      const res = await apiFetch<{ intake: { id: string } }>(`/document-intake/${params.id}/retry`, {
        method: 'POST',
      });
      router.replace(`/document-intake/${res.intake.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось повторить обработку');
      setBusy(false);
    }
  }

  if (authLoading || !isAuthenticated) return null;

  return (
    <AppShell>
      <button onClick={() => router.push('/document-intake')} className="mb-3 text-sm text-ink/50 hover:underline">
        ← К списку загрузок
      </button>

      <h1 className="font-display text-2xl font-semibold text-ink">
        {parentEntityId
          ? 'Подтверждение вложенной записи (страница скана)'
          : data?.intake.targetEntityId
            ? 'Переобработка документа'
            : 'Подтверждение документа'}
      </h1>

      <ErrorText>{error}</ErrorText>

      {data?.intake.possibleDuplicateOfEntityId && (
        <Card className="mt-4 border-gold/40 bg-gold/5">
          <p className="flex items-center gap-2 text-sm text-ink/80">
            <Copy size={16} className="text-gold" />
            Похоже, этот же файл уже был загружен ранее.{' '}
            <Link
              href={`/documents/${data.intake.suggestedEntityType ?? 'generic_document'}/${data.intake.possibleDuplicateOfEntityId}`}
              className="font-medium text-moss-600 underline"
            >
              Открыть существующую запись
            </Link>{' '}
            или продолжите ниже, чтобы создать отдельный документ.
          </p>
        </Card>
      )}

      {data?.intake.status === 'PROCESSING' && (
        <Card className="mt-4 flex items-center gap-3">
          <Loader2 size={20} className="animate-spin text-ink/50" />
          <p className="text-sm text-ink/70">
            Документ в очереди на обработку — распознаём текст и определяем тип. Обычно занимает
            несколько секунд, для многостраничных сканов — дольше. Страница обновится автоматически.
          </p>
        </Card>
      )}

      {data?.intake.status === 'FAILED' && (
        <Card className="mt-4 border-clay/40 bg-clay/5">
          <p className="flex items-center gap-2 text-sm text-clay">
            <AlertTriangle size={16} />
            Не удалось обработать документ (сбой в очереди обработки) — это техническая проблема
            с самой обработкой, а не «OCR не распознал текст».
          </p>
          <Button className="mt-2" variant="secondary" onClick={onRetry} disabled={busy}>
            <RefreshCw size={14} /> Повторить обработку
          </Button>
        </Card>
      )}

      {data && data.intake.status !== 'PROCESSING' && data.intake.status !== 'FAILED' && (
        <>
          <Card className="mt-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Распознанный текст (OCR)</h2>
              {data.ocr?.errorMessage && (
                <Button variant="secondary" onClick={onRetry} disabled={busy}>
                  <RefreshCw size={14} /> Повторить обработку
                </Button>
              )}
            </div>
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

          {data.fieldConflicts && data.fieldConflicts.length > 0 && (
            <Card className="mt-4 border-clay/40 bg-clay/5">
              <h2 className="font-display text-lg font-semibold text-clay">
                Обнаружены новые значения, отличающиеся от уже сохранённых
              </h2>
              <p className="mt-1 text-xs text-ink/60">
                Ранее подтверждённые данные не заменяются автоматически — выберите по каждому полю,
                что оставить.
              </p>
              <div className="mt-3 space-y-3">
                {data.fieldConflicts.map((c) => (
                  <div key={c.field} className="rounded-card bg-white p-3">
                    <p className="text-sm font-medium text-ink">{c.field}</p>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="flex items-center gap-2 rounded-card border border-line p-2 text-sm">
                        <input
                          type="radio"
                          name={`conflict-${c.field}`}
                          checked={conflictChoices[c.field] !== 'suggested'}
                          onChange={() => setConflictChoices((s) => ({ ...s, [c.field]: 'current' }))}
                        />
                        Оставить текущее: <span className="font-mono">{String(c.currentValue)}</span>
                      </label>
                      <label className="flex items-center gap-2 rounded-card border border-line p-2 text-sm">
                        <input
                          type="radio"
                          name={`conflict-${c.field}`}
                          checked={conflictChoices[c.field] === 'suggested'}
                          onChange={() => setConflictChoices((s) => ({ ...s, [c.field]: 'suggested' }))}
                        />
                        Принять новое: <span className="font-mono">{String(c.suggestedValue)}</span>
                        {c.suggestedConfidence != null && (
                          <Badge tone="gold">~{Math.round(c.suggestedConfidence * 100)}%</Badge>
                        )}
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

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
              перед сохранением. Если тип определить не удалось — выберите «Документ (тип не определён)»
              и сохраните с заметкой, разобраться можно позже.
            </p>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              disabled={Boolean(data.intake.targetEntityId)}
              className="mt-3 w-full rounded-card border border-line bg-white px-3 py-2 text-sm disabled:bg-paper-dim"
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
                fieldConfidence={data.intake.suggestedFieldConfidence ?? undefined}
              />
            </Card>
          )}

          <div className="mt-4 flex gap-2">
            <Button onClick={onConfirm} disabled={busy || !entityType}>
              <Check size={16} /> Подтвердить и {data.intake.targetEntityId ? 'обновить карточку' : 'создать карточку'}
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
