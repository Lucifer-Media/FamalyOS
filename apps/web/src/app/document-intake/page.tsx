'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText } from '@/components/ui';
import { Upload } from 'lucide-react';

interface IntakeSummary {
  id: string;
  status: string;
  suggestedEntityType: string | null;
  suggestedConfidence: number | null;
  createdAt: string;
}

export default function DocumentIntakePage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const router = useRouter();
  const [items, setItems] = useState<IntakeSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const data = await apiFetch<IntakeSummary[]>('/document-intake?status=PENDING');
    setItems(data);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const uploaded = await apiFetch<{ id: string }>('/files', { method: 'POST', body: form, isForm: true });
      const { intake } = await apiFetch<{ intake: { id: string } }>(`/document-intake/from-file/${uploaded.id}`, {
        method: 'POST',
      });
      router.push(`/document-intake/${intake.id}`);
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
            ваше подтверждение. Ничего не сохраняется как факт без вашего подтверждения.
          </p>
        </div>
        <div>
          <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={onUpload} />
          <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
            <Upload size={16} /> {uploading ? 'Обрабатываем…' : 'Загрузить документ'}
          </Button>
        </div>
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="mt-6 space-y-2">
        <h2 className="font-display text-lg font-semibold text-ink">Ждут подтверждения</h2>
        {items.map((item) => (
          <Card
            key={item.id}
            className="flex cursor-pointer items-center justify-between hover:shadow-md"
            onClick={() => router.push(`/document-intake/${item.id}`)}
          >
            <div>
              <p className="font-medium text-ink">
                {item.suggestedEntityType ?? 'Тип не определён — потребуется указать вручную'}
              </p>
              <p className="text-xs text-ink/40">
                Загружено {new Date(item.createdAt).toLocaleString('ru-RU')}
                {item.suggestedConfidence != null &&
                  ` · уверенность классификации ~${Math.round(item.suggestedConfidence * 100)}%`}
              </p>
            </div>
          </Card>
        ))}
        {items.length === 0 && <p className="text-sm text-ink/50">Нет документов, ожидающих подтверждения.</p>}
      </div>
    </AppShell>
  );
}
