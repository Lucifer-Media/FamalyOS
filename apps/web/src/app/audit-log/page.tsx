'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, ApiError } from '@/lib/api';
import { Card, ErrorText } from '@/components/ui';
import { translateAuditAction, translateResourceType } from '@/lib/audit-labels';

interface AuditEntry {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  createdAt: string;
  actorUserId: string | null;
}

interface Member {
  userId: string;
  person: { fullName: string };
}

export default function AuditLogPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { currentFamilySpaceId } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentFamilySpaceId) return;
    apiFetch<AuditEntry[]>('/audit-log?limit=100')
      .then(setEntries)
      .catch((e) =>
        setError(
          e instanceof ApiError && e.status === 403
            ? 'Журнал аудита доступен только владельцу или партнёру пространства.'
            : e.message,
        ),
      );
    // Подтягиваем имена участников, чтобы показывать «Кто», а не сырой userId.
    apiFetch<Member[]>(`/family-spaces/${currentFamilySpaceId}/members`)
      .then((members) => {
        const map: Record<string, string> = {};
        for (const m of members) map[m.userId] = m.person.fullName;
        setActorNames(map);
      })
      .catch(() => {
        /* если не хватило прав на список участников — просто не покажем имена */
      });
  }, [currentFamilySpaceId]);

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold text-ink">Журнал аудита</h1>
      <p className="mt-1 text-sm text-ink/60">
        Неизменяемая запись всех значимых действий и событий безопасности в пространстве.
      </p>

      <ErrorText>{error}</ErrorText>

      <Card className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-ink/50">
              <th className="py-2 pr-3 font-medium">Когда</th>
              <th className="py-2 pr-3 font-medium">Кто</th>
              <th className="py-2 pr-3 font-medium">Действие</th>
              <th className="py-2 pr-3 font-medium">Объект</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-line/60 last:border-0">
                <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-ink/60">
                  {new Date(e.createdAt).toLocaleString('ru-RU')}
                </td>
                <td className="py-2 pr-3 text-ink/70">
                  {e.actorUserId ? (actorNames[e.actorUserId] ?? 'Участник') : 'Система'}
                </td>
                <td className="py-2 pr-3">{translateAuditAction(e.action)}</td>
                <td className="py-2 pr-3 text-ink/60">
                  {e.resourceType ? (
                    <>
                      {translateResourceType(e.resourceType)}
                      {e.resourceId && (
                        <span className="ml-1 font-mono text-xs text-ink/40">
                          · {e.resourceId.slice(0, 8)}
                        </span>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && !error && (
          <p className="py-6 text-center text-sm text-ink/50">Записей пока нет.</p>
        )}
      </Card>
    </AppShell>
  );
}

