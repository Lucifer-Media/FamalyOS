'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { apiFetch } from '@/lib/api';
import { Card, Button } from '@/components/ui';
import { FinanceSubNav } from '@/components/finance-subnav';

interface CategoryAnalytics {
  category: string;
  income: number;
  expense: number;
  net: number;
  transactionCount: number;
  previousExpense?: number;
  changePercent?: number | null;
}

function monthStart(offsetMonths = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths, 1);
  return d.toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AnalyticsPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(today());
  const [data, setData] = useState<CategoryAnalytics[]>([]);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const result = await apiFetch<CategoryAnalytics[]>(
        `/finance/analytics/compare-previous?startDate=${startDate}&endDate=${endDate}`,
      );
      setData(result);
    } catch (e) {
      setError('Не удалось загрузить аналитику');
    }
  }

  useEffect(() => {
    load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !isAuthenticated) return null;

  const totalExpense = data.reduce((s, d) => s + d.expense, 0);
  const totalIncome = data.reduce((s, d) => s + d.income, 0);

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold text-ink">Аналитика расходов</h1>
      <p className="mt-1 text-sm text-ink/60">По категориям, со сравнением с предыдущим таким же периодом.</p>

      <div className="mt-4">
        <FinanceSubNav active="/finance/analytics" />
      </div>

      <Card className="mt-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-ink/50">С</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink/50">По</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
            />
          </div>
          <Button onClick={load}>Показать</Button>
        </div>
      </Card>

      {error && <p className="mt-3 text-sm text-clay">{error}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-ink/50">Доходы за период</p>
          <p className="mt-1 font-display text-xl font-semibold text-moss-600">{totalIncome.toLocaleString('ru-RU')} ₽</p>
        </Card>
        <Card>
          <p className="text-xs text-ink/50">Расходы за период</p>
          <p className="mt-1 font-display text-xl font-semibold text-clay">{totalExpense.toLocaleString('ru-RU')} ₽</p>
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="font-display text-lg font-semibold">По категориям</h2>
        <div className="mt-2 divide-y divide-line">
          {data.map((d) => (
            <div key={d.category} className="flex items-center justify-between py-2 text-sm">
              <div>
                <p className="text-ink">{d.category}</p>
                <p className="text-xs text-ink/40">{d.transactionCount} операций</p>
              </div>
              <div className="text-right">
                <p className="text-clay">{d.expense.toLocaleString('ru-RU')} ₽</p>
                {d.changePercent != null && (
                  <p className={`text-xs ${d.changePercent > 0 ? 'text-clay' : 'text-moss-600'}`}>
                    {d.changePercent > 0 ? '+' : ''}
                    {d.changePercent}% к пред. периоду
                  </p>
                )}
              </div>
            </div>
          ))}
          {data.length === 0 && <p className="py-2 text-sm text-ink/50">Нет операций за выбранный период.</p>}
        </div>
      </Card>
    </AppShell>
  );
}
