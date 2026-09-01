'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { apiFetch } from '@/lib/api';
import { Card } from '@/components/ui';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { Wallet, TrendingDown, Target, AlertCircle } from 'lucide-react';
import { FinanceSubNav } from '@/components/finance-subnav';

interface DashboardData {
  totalBalance: number;
  spentThisMonth: number;
  plannedThisMonth: number;
  daysLeftInMonth: number;
  dailyBudgetRemaining: number | null;
  upcomingNeeds: { id: string; name: string; amountMonthly: number; nextDueDate: string; priority: string }[];
  topCategories: { category: string; amount: number }[];
  monthlyTrend: { month: string; income: number; expense: number }[];
  goalsProgress: { id: string; name: string; targetAmount: number; currentAmount: number; deadline?: string }[];
}

function fmt(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

export default function FinanceDashboardPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<DashboardData>('/finance/dashboard')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold text-ink">Финансовый дашборд</h1>
      <p className="mt-1 text-sm text-ink/60">Всё в одном месте — баланс, расходы, бюджет, цели.</p>

      <div className="mt-4">
        <FinanceSubNav active="/finance/dashboard" />
      </div>

      {error && <p className="mt-3 text-sm text-clay">{error}</p>}
      {!data && !error && <p className="mt-4 text-sm text-ink/50">Загрузка…</p>}

      {data && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card>
              <div className="flex items-center gap-2 text-ink/50">
                <Wallet size={16} /> <span className="text-xs">Баланс всех счетов</span>
              </div>
              <p className="mt-1 font-display text-xl font-semibold text-ink">{fmt(data.totalBalance)} ₽</p>
            </Card>
            <Card>
              <div className="flex items-center gap-2 text-ink/50">
                <TrendingDown size={16} /> <span className="text-xs">Потрачено в этом месяце</span>
              </div>
              <p className="mt-1 font-display text-xl font-semibold text-clay">{fmt(data.spentThisMonth)} ₽</p>
              {data.plannedThisMonth > 0 && <p className="text-xs text-ink/40">из плана {fmt(data.plannedThisMonth)} ₽</p>}
            </Card>
            <Card>
              <div className="flex items-center gap-2 text-ink/50">
                <Target size={16} /> <span className="text-xs">Осталось на день</span>
              </div>
              <p className="mt-1 font-display text-xl font-semibold text-ink">
                {data.dailyBudgetRemaining != null ? `${fmt(data.dailyBudgetRemaining)} ₽` : '—'}
              </p>
              <p className="text-xs text-ink/40">{data.daysLeftInMonth} дн. до конца месяца</p>
            </Card>
            <Card>
              <div className="flex items-center gap-2 text-ink/50">
                <AlertCircle size={16} /> <span className="text-xs">Платежи на неделе</span>
              </div>
              <p className="mt-1 font-display text-xl font-semibold text-ink">
                {fmt(data.upcomingNeeds.reduce((s, n) => s + n.amountMonthly, 0))} ₽
              </p>
              <p className="text-xs text-ink/40">{data.upcomingNeeds.length} платежей</p>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="font-display text-lg font-semibold">Топ категорий расходов</h2>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.topCategories} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="category" type="category" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => `${fmt(v)} ₽`} />
                    <Bar dataKey="amount" fill="#c1440e" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <h2 className="font-display text-lg font-semibold">Динамика (6 месяцев)</h2>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => `${fmt(v)} ₽`} />
                    <Legend />
                    <Line type="monotone" dataKey="income" name="Доход" stroke="#5c7a5c" strokeWidth={2} />
                    <Line type="monotone" dataKey="expense" name="Расход" stroke="#c1440e" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.upcomingNeeds.length > 0 && (
              <Card>
                <h2 className="font-display text-lg font-semibold">Ближайшие обязательные платежи</h2>
                <div className="mt-2 divide-y divide-line">
                  {data.upcomingNeeds.map((n) => (
                    <div key={n.id} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <p className="text-ink">{n.name}</p>
                        <p className="text-xs text-ink/40">{n.nextDueDate}</p>
                      </div>
                      <p className="text-clay">{fmt(n.amountMonthly)} ₽</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {data.goalsProgress.length > 0 && (
              <Card>
                <h2 className="font-display text-lg font-semibold">Прогресс целей</h2>
                <div className="mt-3 space-y-3">
                  {data.goalsProgress.map((g) => {
                    const percent = g.targetAmount > 0 ? Math.min((g.currentAmount / g.targetAmount) * 100, 100) : 0;
                    return (
                      <div key={g.id}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-ink">{g.name}</span>
                          <span className="text-ink/50">
                            {fmt(g.currentAmount)} / {fmt(g.targetAmount)} ₽
                          </span>
                        </div>
                        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-paper-dim">
                          <div className="h-full bg-moss-600" style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
