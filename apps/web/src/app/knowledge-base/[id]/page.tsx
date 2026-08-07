'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Field, Input, Textarea } from '@/components/ui';
import { History, Save } from 'lucide-react';

interface Article {
  id: string;
  title: string;
  status: string;
  currentVersion: number;
  attributes: { content: string; folder?: string; tags?: string[] };
}

interface VersionEntry {
  versionNumber: number;
  action: string;
  changeSummary: string | null;
  changedAt: string;
}

export default function ArticleDetailPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [article, setArticle] = useState<Article | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const a = await apiFetch<Article>(`/knowledge-base/articles/${params.id}`);
    setArticle(a);
    setTitle(a.title);
    setContent(a.attributes.content ?? '');
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'));
  }, [params.id]);

  async function loadVersions() {
    const v = await apiFetch<VersionEntry[]>(`/knowledge-base/articles/${params.id}/versions`);
    setVersions(v);
    setShowVersions(true);
  }

  async function onSave() {
    setSaving(true);
    setError('');
    try {
      const updated = await apiFetch<Article>(`/knowledge-base/articles/${params.id}`, {
        method: 'PATCH',
        body: { title, content },
      });
      setArticle(updated);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError('У вас нет прав на редактирование этой записи.');
      } else {
        setError(e instanceof Error ? e.message : 'Не удалось сохранить');
      }
    } finally {
      setSaving(false);
    }
  }

  async function onRevert(versionNumber: number) {
    if (!confirm(`Откатить к версии ${versionNumber}? Текущее состояние сохранится в истории.`)) return;
    const updated = await apiFetch<Article>(`/knowledge-base/articles/${params.id}/revert`, {
      method: 'POST',
      body: { versionNumber },
    });
    setArticle(updated);
    setTitle(updated.title);
    setContent(updated.attributes.content ?? '');
    await loadVersions();
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <button onClick={() => router.push('/knowledge-base')} className="mb-3 text-sm text-ink/50 hover:underline">
        ← К базе знаний
      </button>

      {!article && !error && <p className="text-sm text-ink/50">Загрузка…</p>}
      <ErrorText>{error}</ErrorText>

      {article && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Field label="Заголовок">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="text-lg font-semibold" />
            </Field>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={loadVersions}>
                <History size={16} /> Версии (v{article.currentVersion})
              </Button>
              <Button onClick={onSave} disabled={saving}>
                <Save size={16} /> {saving ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </div>

          <div className="mt-4 flex gap-2 text-sm">
            <button
              className={mode === 'edit' ? 'font-semibold text-moss-700' : 'text-ink/50'}
              onClick={() => setMode('edit')}
            >
              Редактор
            </button>
            <span className="text-ink/30">/</span>
            <button
              className={mode === 'preview' ? 'font-semibold text-moss-700' : 'text-ink/50'}
              onClick={() => setMode('preview')}
            >
              Просмотр
            </button>
          </div>

          <Card className="mt-2">
            {mode === 'edit' ? (
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={16}
                className="font-mono text-sm"
              />
            ) : (
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            )}
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
                      {v.changeSummary && <div className="text-ink/60">{v.changeSummary}</div>}
                    </div>
                    {v.versionNumber !== article.currentVersion && (
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
