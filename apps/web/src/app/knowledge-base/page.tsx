'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { apiFetch } from '@/lib/api';
import { Button, Card, Field, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { Plus } from 'lucide-react';

interface Article {
  id: string;
  title: string;
  status: string;
  currentVersion: number;
  updatedAt: string;
  attributes: { folder?: string; tags?: string[] };
}

export default function KnowledgeBasePage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { currentFamilySpaceId } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const data = await apiFetch<Article[]>('/knowledge-base/articles');
    setArticles(data);
  }

  useEffect(() => {
    if (currentFamilySpaceId) load().catch((e) => setError(e.message));
  }, [currentFamilySpaceId]);

  async function onCreate() {
    setBusy(true);
    setError('');
    try {
      const created = await apiFetch<Article>('/knowledge-base/articles', {
        method: 'POST',
        body: { title, content: '# ' + title + '\n\nНачните писать здесь…' },
      });
      window.location.href = `/knowledge-base/${created.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать статью');
      setBusy(false);
    }
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Семейная база знаний</h1>
          <p className="mt-1 text-sm text-ink/60">Markdown-заметки с версиями и связями с другими записями.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} /> Новая статья
        </Button>
      </div>

      {creating && (
        <Card className="mt-4">
          <Field label="Заголовок статьи">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </Field>
          {error && <p className="mt-2 text-sm text-clay">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button onClick={onCreate} disabled={busy || !title.trim()}>
              {busy ? 'Создаём…' : 'Создать'}
            </Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {articles.map((a) => (
          <Link key={a.id} href={`/knowledge-base/${a.id}`}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <h3 className="font-display text-lg font-semibold text-ink">{a.title}</h3>
                <span className="rounded-full bg-paper-dim px-2 py-0.5 text-xs text-ink/60">
                  v{a.currentVersion}
                </span>
              </div>
              {a.attributes?.folder && <p className="mt-1 text-xs text-ink/50">{a.attributes.folder}</p>}
              <p className="mt-2 text-xs text-ink/40">
                Обновлено {new Date(a.updatedAt).toLocaleString('ru-RU')}
              </p>
            </Card>
          </Link>
        ))}
        {articles.length === 0 && !creating && (
          <p className="text-sm text-ink/50">Пока нет ни одной статьи — создайте первую.</p>
        )}
      </div>
    </AppShell>
  );
}
