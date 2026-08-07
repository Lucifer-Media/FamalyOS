'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { Card } from '@/components/ui';

interface SearchHit {
  id: string;
  entityType: string;
  title: string;
  snippet: string;
  rank: number;
}

function SearchResults() {
  const { currentFamilySpaceId } = useAuth();
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);

  useEffect(() => {
    if (!q || !currentFamilySpaceId) return;
    setLoadingResults(true);
    apiFetch<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`)
      .then(setResults)
      .finally(() => setLoadingResults(false));
  }, [q, currentFamilySpaceId]);

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold text-ink">Поиск: «{q}»</h1>
      {loadingResults && <p className="mt-4 text-sm text-ink/50">Ищем…</p>}
      <div className="mt-4 space-y-3">
        {results.map((r) => (
          <Link key={r.id} href={r.entityType === 'knowledge_article' ? `/knowledge-base/${r.id}` : '#'}>
            <Card className="hover:shadow-md">
              <h3 className="font-display text-lg font-semibold text-ink">{r.title}</h3>
              <p className="mt-1 text-sm text-ink/70" dangerouslySetInnerHTML={{ __html: r.snippet }} />
            </Card>
          </Link>
        ))}
        {!loadingResults && results.length === 0 && q && (
          <p className="text-sm text-ink/50">Ничего не найдено.</p>
        )}
      </div>
    </AppShell>
  );
}

export default function SearchPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  if (loading || !isAuthenticated) return null;
  return (
    <Suspense fallback={null}>
      <SearchResults />
    </Suspense>
  );
}
