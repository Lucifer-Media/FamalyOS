'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Badge } from '@/components/ui';
import { Upload, Loader2, AlertTriangle } from 'lucide-react';

interface IntakeSummary {
  id: string;
  status: string;
  suggestedEntityType: string | null;
  suggestedConfidence: number | null;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  PROCESSING: 'Обрабатывается…',
  PENDING: 'Ждёт подтверждения',
  FAILED: 'Ошибка обработки',
};

export default function DocumentIntakePage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const router = useRouter();
  const [items, setItems] = useState<IntakeSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    // Загружаем и обрабатываемые, и ждущие подтверждения, и сбойные —
    // чтобы пользователь видел весь конвейер, а не только готовые записи.
    const [processing, pending, failed] = await Promise.all([
      apiFetch<IntakeSummary[]>('/document-intake?status=PROCESSING'),
      apiFetch<IntakeSummary[]>('/document-intake?status=PENDING'),
      apiFetch<IntakeSummary[]>('/document-intake?status=FAILED'),
    ]);
    setItems([...processing, ...failed, ...pending]);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  // Пока есть документы в обработке — периодически обновляем список
  // (сами документы обрабатываются в фоне через очередь Redis/BullMQ,
  // это может занимать секунды-десятки секунд).
  useEffect(() => {
    const hasProcessing = items.some((i) => i.status === 'PROCESSING');
    if (!hasProcessing) return;
    const timer = setInterval(() => load().catch(() => undefined), 3000);
    return () => clearInterval(timer);
  }, [items]);

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError('');
    try {
      const uploadedIntakeIds: string[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        const uploaded = await apiFetch<{ id: string }>('/files', { method: 'POST', body: form, isForm: true });
        const { intake } = await apiFetch<{ intake: { id: string } }>(`/document-intake/from-file/${uploaded.id}`, {
          method: 'POST',
        });
        uploadedIntakeIds.push(intake.id);
      }
      // Один файл — сразу открываем его карточку (там видно OCR-прогресс).
      // Несколько файлов — остаёмся на списке, все они видны как "в обработке".
      if (uploadedIntakeIds.length === 1) {
        router.push(`/document-intake/${uploadedIntakeIds[0]}`);
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось обработать документ');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Загрузка документа</h1>
          <p className="mt-1 text-sm text-ink/60">
            Загрузка → распознавание текста (OCR) → определение типа → предзаполненная карточка →
            ваше подтверждение. Ничего не сохраняется как факт без вашего подтверждения. Можно
            выбрать сразу несколько файлов — они обрабатываются в фоне, не блокируя интерфейс.
          </p>
        </div>
        <div>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            multiple
            className="hidden"
            onChange={onUpload}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
            <Upload size={16} /> {uploading ? 'Загружаем…' : 'Загрузить документ(ы)'}
          </Button>
        </div>
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="mt-6 space-y-2">
        <h2 className="font-display text-lg font-semibold text-ink">Конвейер обработки</h2>
        {items.map((item) => (
          <Card
            key={item.id}
            className="flex cursor-pointer items-center justify-between hover:shadow-md"
            onClick={() => router.push(`/document-intake/${item.id}`)}
          >
            <div className="flex items-center gap-3">
              {item.status === 'PROCESSING' && <Loader2 size={16} className="animate-spin text-ink/40" />}
              {item.status === 'FAILED' && <AlertTriangle size={16} className="text-clay" />}
              <div>
                <p className="font-medium text-ink">
                  {item.suggestedEntityType ?? (item.status === 'PROCESSING' ? 'Определяем тип…' : 'Тип не определён — потребуется указать вручную')}
                </p>
                <p className="text-xs text-ink/40">
                  Загружено {new Date(item.createdAt).toLocaleString('ru-RU')}
                  {item.suggestedConfidence != null &&
                    ` · уверенность классификации ~${Math.round(item.suggestedConfidence * 100)}%`}
                </p>
              </div>
            </div>
            <Badge tone={item.status === 'FAILED' ? 'clay' : item.status === 'PROCESSING' ? 'default' : 'moss'}>
              {STATUS_LABELS[item.status] ?? item.status}
            </Badge>
          </Card>
        ))}
        {items.length === 0 && <p className="text-sm text-ink/50">Нет документов в обработке.</p>}
      </div>
    </AppShell>
  );
}
