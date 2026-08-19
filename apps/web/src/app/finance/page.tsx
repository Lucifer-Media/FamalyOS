'use client';

import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { Card, Button } from '@/components/ui';
import Link from 'next/link';

export default function FinancePage() {
  const { loading, isAuthenticated } = useRequireAuth();

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">Финансы</h1>
        <div className="flex gap-2">
          <Link href="/finance/accounts">
            <Button variant="outline">Счета</Button>
          </Link>
          <Link href="/finance/operations">
            <Button variant="outline">Операции</Button>
          </Link>
          <Link href="/finance/budgets">
            <Button variant="outline">Бюджеты</Button>
          </Link>
          <Link href="/finance/analytics">
            <Button variant="primary">Аналитика</Button>
          </Link>
        </div>
      </div>

      <p className="mt-1 text-sm text-ink/60">
        Управление банковскими счетами, учёт операций, планирование бюджетов и аналитика расходов.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="p-4 transition-shadow hover:shadow-md">
          <Link href="/finance/accounts">
            <h2 className="font-display text-lg font-semibold text-ink">Банковские счета</h2>
            <p className="mt-2 text-sm text-ink/60">
              Карточные, расчётные, кредитные счета и вклады. Учёт баланса и истории.
            </p>
          </Link>
        </Card>

        <Card className="p-4 transition-shadow hover:shadow-md">
          <Link href="/finance/operations">
            <h2 className="font-display text-lg font-semibold text-ink">Операции</h2>
            <p className="mt-2 text-sm text-ink/60">
              Доходы, расходы, переводы. Импорт из банковских выписок (OFX, CSV).
            </p>
          </Link>
        </Card>

        <Card className="p-4 transition-shadow hover:shadow-md">
          <Link href="/finance/budgets">
            <h2 className="font-display text-lg font-semibold text-ink">Бюджеты</h2>
            <p className="mt-2 text-sm text-ink/60">
              Планирование доходов и расходов по периодам и категориям.
            </p>
          </Link>
        </Card>

        <Card className="p-4 transition-shadow hover:shadow-md">
          <Link href="/finance/analytics">
            <h2 className="font-display text-lg font-semibold text-ink">Аналитика</h2>
            <p className="mt-2 text-sm text-ink/60">
              Распределение расходов по категориям, динамика по периодам.
            </p>
          </Link>
        </Card>

        <Card className="p-4 transition-shadow hover:shadow-md">
          <Link href="/finance/import">
            <h2 className="font-display text-lg font-semibold text-ink">Импорт выписок</h2>
            <p className="mt-2 text-sm text-ink/60">
              Загрузка выписок из Т-Банка, Альфа-Банка и других банков (OFX, CSV).
            </p>
          </Link>
        </Card>
      </div>
    </AppShell>
  );
}
