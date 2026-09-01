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

interface ParticipantAnalytics {
  personId: string | null;
  personName: string;
  income: number;
  expense: number;
  net: number;
  transactionCount: number;
}

interface HeatmapDay {
  date: string;
  expense: number;
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
  const [participants, setParticipants] = useState<ParticipantAnalytics[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapDay[]>([]);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const [byCategory, byParticipant, heatmapDays] = await Promise.all([
        apiFetch<CategoryAnalytics[]>(`/finance/analytics/compare-previous?startDate=${startDate}&endDate=${endDate}`),
        apiFetch<ParticipantAnalytics[]>(`/finance/analytics/by-participant?startDate=${startDate}&endDate=${endDate}`),
        apiFetch<HeatmapDay[]>(`/finance/analytics/heatmap?startDate=${startDate}&endDate=${endDate}`),
      ]);
      setData(byCategory);
      setParticipants(byParticipant);
      setHeatmap(heatmapDays);
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

      <Card className="mt-4">
        <h2 className="font-display text-lg font-semibold">По участникам</h2>
        <div className="mt-2 divide-y divide-line">
          {participants.map((p) => (
            <div key={p.personId ?? 'unassigned'} className="flex items-center justify-between py-2 text-sm">
              <div>
                <p className="text-ink">{p.personName}</p>
                <p className="text-xs text-ink/40">{p.transactionCount} операций</p>
              </div>
              <div className="text-right">
                <p className="text-moss-600">+{p.income.toLocaleString('ru-RU')} ₽</p>
                <p className="text-clay">-{p.expense.toLocaleString('ru-RU')} ₽</p>
              </div>
            </div>
          ))}
          {participants.length === 0 && <p className="py-2 text-sm text-ink/50">Нет операций за выбранный период.</p>}
        </div>
      </Card>

      <Card className="mt-4">
        <h2 className="font-display text-lg font-semibold">Тепловая карта расходов</h2>
        <p className="mt-1 text-xs text-ink/60">Интенсивность цвета — сумма расходов за день, за выбранный период.</p>
        <SpendingHeatmap days={heatmap} />
      </Card>
    </AppShell>
  );
}

/** Тепловая карта расходов по дням — сетка недель/дней (как GitHub-граф вкладов). */
function SpendingHeatmap({ days }: { days: HeatmapDay[] }) {
  if (days.length === 0) return <p className="mt-3 text-sm text-ink/50">Нет данных за выбранный период.</p>;

  const maxExpense = Math.max(1, ...days.map((d) => d.expense));
  const firstDate = new Date(`${days[0].date}T00:00:00Z`);
  const leadingBlanks = (firstDate.getUTCDay() + 6) % 7; // 0 = Пн

  const cells: (HeatmapDay | null)[] = [...Array(leadingBlanks).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (HeatmapDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  function colorFor(expense: number): string {
    if (expense <= 0) return 'var(--tw-color-paper-dim, #eee)';
    const intensity = Math.min(1, expense / maxExpense);
    // от светло-персикового к насыщенному clay — по интенсивности трат
    const alpha = 0.15 + intensity * 0.75;
    return `rgba(208, 90, 74, ${alpha.toFixed(2)})`;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <div className="flex gap-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((day, di) => (
              <div
                key={di}
                title={day ? `${day.date}: ${day.expense.toLocaleString('ru-RU')} ₽` : undefined}
                className="h-3.5 w-3.5 rounded-sm border border-line/50"
                style={{ background: day ? colorFor(day.expense) : 'transparent', borderColor: day ? undefined : 'transparent' }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1 text-xs text-ink/40">
        <span>меньше</span>
        {[0.15, 0.35, 0.55, 0.75, 0.9].map((a) => (
          <div key={a} className="h-3 w-3 rounded-sm" style={{ background: `rgba(208, 90, 74, ${a})` }} />
        ))}
        <span>больше</span>
      </div>
    </div>
  );
}
