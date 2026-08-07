'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, getAccessToken, getCurrentFamilySpaceId } from '@/lib/api';
import { Button, Card, ErrorText } from '@/components/ui';
import { Upload, Download, Archive } from 'lucide-react';

interface FileItem {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  currentVersion: number;
  confidentialityLevel: string;
  status: string;
  createdAt: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export default function FilesPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { currentFamilySpaceId } = useAuth();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const data = await apiFetch<FileItem[]>('/files');
    setFiles(data);
  }

  useEffect(() => {
    if (currentFamilySpaceId) load().catch((e) => setError(e.message));
  }, [currentFamilySpaceId]);

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      await apiFetch('/files', { method: 'POST', body: form, isForm: true });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить файл');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function onDownload(file: FileItem) {
    const token = getAccessToken();
    const spaceId = getCurrentFamilySpaceId();
    const res = await fetch(`/api/files/${file.id}/download`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(spaceId ? { 'X-Family-Space-Id': spaceId } : {}),
      },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.originalName;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onArchive(file: FileItem) {
    if (!confirm(`Архивировать «${file.originalName}»? Файл не удаляется — сохраняется и доступен из истории.`))
      return;
    await apiFetch(`/files/${file.id}/archive`, { method: 'PATCH' });
    await load();
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Файлы</h1>
          <p className="mt-1 text-sm text-ink/60">Семейное хранилище документов, сканов и вложений.</p>
        </div>
        <div>
          <input ref={inputRef} type="file" className="hidden" onChange={onUpload} />
          <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
            <Upload size={16} /> {uploading ? 'Загружаем…' : 'Загрузить файл'}
          </Button>
        </div>
      </div>

      <ErrorText>{error}</ErrorText>

      <Card className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-ink/50">
              <th className="py-2 pr-3 font-medium">Файл</th>
              <th className="py-2 pr-3 font-medium">Размер</th>
              <th className="py-2 pr-3 font-medium">Версия</th>
              <th className="py-2 pr-3 font-medium">Статус</th>
              <th className="py-2 pr-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} className="border-b border-line/60 last:border-0">
                <td className="py-2 pr-3">{f.originalName}</td>
                <td className="py-2 pr-3 text-ink/60">{formatSize(f.sizeBytes)}</td>
                <td className="py-2 pr-3 text-ink/60">v{f.currentVersion}</td>
                <td className="py-2 pr-3 text-ink/60">{f.status}</td>
                <td className="py-2 pr-3">
                  <div className="flex gap-2">
                    <button onClick={() => onDownload(f)} className="text-moss-600 hover:underline" title="Скачать">
                      <Download size={16} />
                    </button>
                    {f.status !== 'ARCHIVED' && (
                      <button onClick={() => onArchive(f)} className="text-ink/40 hover:text-clay" title="Архивировать">
                        <Archive size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {files.length === 0 && <p className="py-6 text-center text-sm text-ink/50">Файлов пока нет.</p>}
      </Card>
    </AppShell>
  );
}
