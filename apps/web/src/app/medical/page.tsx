'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { Card, Badge } from '@/components/ui';
import { MEDICAL_TYPE_GROUPS } from '@/lib/entity-type-schemas';
import { useEntityTypeList } from '@/lib/use-entity-types';
import { apiFetch } from '@/lib/api';
import { AlertTriangle } from 'lucide-react';

interface ExpiringItem {
  id: string;
  title: string;
  expiryDate: string;
  daysLeft: number;
}

export default function MedicalPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { schemas } = useEntityTypeList();
  const [expiring, setExpiring] = useState<ExpiringItem[]>([]);

  useEffect(() => {
    apiFetch<ExpiringItem[]>('/first-aid-kits/expiring?days=30')
      .then(setExpiring)
      .catch(() => {
        /* нет прав или ещё нет данных — не критично для отображения страницы */
      });
  }, []);

  if (loading || !isAuthenticated) return null;

  const labelFor = (type: string) => schemas.find((s) => s.entityType === type)?.labelPlural ?? type;

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold text-ink">Медицина и аптечки</h1>
      <p className="mt-1 text-sm text-ink/60">Повышенный уровень конфиденциальности данных.</p>

      {expiring.length > 0 && (
        <Card className="mt-4 border-clay/40 bg-clay/5">
          <div className="flex items-center gap-2 text-clay">
            <AlertTriangle size={18} />
            <p className="font-medium">
              Через 30 дней истекает срок годности {expiring.length}{' '}
              {pluralizePreparations(expiring.length)}
            </p>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {expiring.map((item) => (
              <li key={item.id} className="flex items-center justify-between">
                <span>{item.title}</span>
                <Badge tone={item.daysLeft <= 7 ? 'clay' : 'default'}>
                  {item.daysLeft <= 0 ? 'просрочено' : `через ${item.daysLeft} дн.`}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {MEDICAL_TYPE_GROUPS.map((group) => (
        <div key={group.title} className="mt-6">
          <h2 className="mb-2 font-display text-lg font-semibold text-ink">{group.title}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.types.map((type) => (
              <Link key={type} href={`/documents/${type}`}>
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

function pluralizePreparations(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'препарата';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'препаратов';
  return 'препаратов';
}
