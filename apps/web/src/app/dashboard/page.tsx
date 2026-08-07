'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { Card } from '@/components/ui';
import { BookOpen, FolderClosed, Users } from 'lucide-react';

export default function DashboardPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { currentFamilySpaceId, familySpaces } = useAuth();
  const [counts, setCounts] = useState<{ articles: number; files: number; members: number } | null>(null);

  useEffect(() => {
    if (!currentFamilySpaceId) return;
    Promise.all([
      apiFetch<any[]>('/knowledge-base/articles'),
      apiFetch<any[]>('/files'),
      apiFetch<any[]>('/family-spaces/' + currentFamilySpaceId + '/members'),
    ])
      .then(([articles, files, members]) =>
        setCounts({ articles: articles.length, files: files.length, members: members.length }),
      )
      .catch(() => setCounts(null));
  }, [currentFamilySpaceId]);

  if (loading || !isAuthenticated) return null;

  const currentSpace = familySpaces.find((s) => s.id === currentFamilySpaceId);

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold text-ink">
        {currentSpace ? currentSpace.name : 'Ваше пространство'}
      </h1>
      <p className="mt-1 text-sm text-ink/60">
        Единый жизненный контекст семьи — фундамент заложен, дальше будут добавляться документы,
        финансы, здоровье и путешествия.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          href="/knowledge-base"
          icon={<BookOpen size={18} />}
          label="Статей в базе знаний"
          value={counts?.articles ?? '—'}
        />
        <StatCard href="/files" icon={<FolderClosed size={18} />} label="Файлов" value={counts?.files ?? '—'} />
        <StatCard href="/members" icon={<Users size={18} />} label="Участников" value={counts?.members ?? '—'} />
      </div>

      <Card className="mt-6">
        <h2 className="font-display text-lg font-semibold text-ink">Что уже готово в Итерации 1</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/70">
          <li>Семейное пространство, роли и точечные права доступа</li>
          <li>Обязательная двухфакторная аутентификация</li>
          <li>Универсальная сущность с версионированием (как в Git) и связями</li>
          <li>Семейная база знаний на Markdown</li>
          <li>Файловое хранилище с версиями</li>
          <li>Полнотекстовый поиск и журнал аудита</li>
        </ul>
      </Card>
    </AppShell>
  );
}

function StatCard({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <Link href={href}>
      <Card className="transition-shadow hover:shadow-md">
        <div className="flex items-center gap-2 text-ink/50">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <p className="mt-2 font-display text-3xl font-semibold text-ink">{value}</p>
      </Card>
    </Link>
  );
}
