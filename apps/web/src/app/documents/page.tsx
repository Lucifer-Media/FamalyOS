'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { Card } from '@/components/ui';
import { DOCUMENT_TYPE_GROUPS } from '@/lib/entity-type-schemas';
import { useEntityTypeList } from '@/lib/use-entity-types';

export default function DocumentsPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { schemas } = useEntityTypeList();

  if (loading || !isAuthenticated) return null;

  const labelFor = (type: string) => schemas.find((s) => s.entityType === type)?.labelPlural ?? type;

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold text-ink">Документы</h1>
      <p className="mt-1 text-sm text-ink/60">
        Личные документы, имущество и цифровые аккаунты. Паспорт РФ имеет отдельную расширенную
        карточку — остальные типы используют единую форму по своей схеме полей.
      </p>

      {DOCUMENT_TYPE_GROUPS.map((group) => (
        <div key={group.title} className="mt-6">
          <h2 className="mb-2 font-display text-lg font-semibold text-ink">{group.title}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.types.map((type) => (
              <Link key={type} href={type === 'passport_rf' ? '/documents/passport-rf' : `/documents/${type}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <p className="font-medium text-ink">{labelFor(type)}</p>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </AppShell>
  );
}
