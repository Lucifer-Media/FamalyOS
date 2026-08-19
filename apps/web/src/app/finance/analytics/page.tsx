'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';

interface CategoryAnalytics {
  category: string;
  income: number;
  expense: number;
}

interface MonthlyTrend {
  month: string;
  income: number;
  expense: number;
}

export default function AnalyticsPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const [categoryData, setCategoryData] = useState<CategoryAnalytics[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlyTrend[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [period, setPeriod] = useState<'MONTH' | 'QUARTER' | 'YEAR'>('MONTH');

  useEffect(() => {
    if (isAuthenticated) {
      loadAnalytics();
    }
  }, [isAuthenticated, period]);

  const loadAnalytics = async () => {
    try {
      setLoadingData(true);
      
      // Загружаем аналитику по категориям
      const endDate = new Date();
      const startDate = new Date();
      
      if (period === 'MONTH') {
        startDate.setMonth(startDate.getMonth() - 1);
      } else if (period === 'QUARTER') {
        startDate.setMonth(startDate.getMonth() - 3);
      } else {
        startDate.setFullYear(startDate.getFullYear() - 1);
      }
      
      const [categoriesRes, operationsRes] = await Promise.all([
        api.get(`/finance/analytics/categories?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`),
        api.get(`/finance/operations?limit=1000`),
      ]);
      
      setCategoryData(categoriesRes.categories || []);
      
      // Группируем операции по месяцам
      const months: Record<string, { income: number; expense: number }> = {};
      for (const op of operationsRes) {
        const date = new Date(op.attributes.operationDate);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        if (!months[monthKey]) {
          months[monthKey] = { income: 0, expense: 0 };
        }
        
        if (op.attributes.operationType === 'INCOME') {
          months[monthKey].income += parseFloat(op.attributes.amount) || 0;
        } else if (op.attributes.operationType === 'EXPENSE') {
          months[monthKey].expense += parseFloat(op.attributes.amount) || 0;
        }
      }
      
      const monthlyTrends: MonthlyTrend[] = Object.entries(months)
        .map(([month, data]) => ({
          month,
          income: data.income,
          expense: data.expense,
        }))
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-6); // Последние 6 месяцев
      
      setMonthlyData(monthlyTrends);
    } catch (error) {
      console.error('Ошибка загрузки аналитики:', error);
    } finally {
      setLoadingData(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const totalIncome = categoryData.reduce((sum, cat) => sum + cat.income, 0);
  const totalExpense = categoryData.reduce((sum, cat) => sum + cat.expense, 0);
  const balance = totalIncome - totalExpense;

  if (loading || loadingData || !isAuthenticated) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-12">
          <p className="text-ink/60">Загрузка...</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">Финансовая аналитика</h1>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as any)}
          className="rounded border border-ink/20 px-3 py-1.5 text-sm"
        >
          <option value="MONTH">Месяц</option>
          <option value="QUARTER">Квартал</option>
          <option value="YEAR">Год</option>
        </select>
      </div>

      {/* Сводка */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm text-ink/60">Доходы</p>
          <p className="mt-1 text-2xl font-semibold text-green-600">{formatCurrency(totalIncome)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-ink/60">Расходы</p>
          <p className="mt-1 text-2xl font-semibold text-red-600">{formatCurrency(totalExpense)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-ink/60">Баланс</p>
          <p className={`mt-1 text-2xl font-semibold ${balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(balance)}
          </p>
        </Card>
      </div>

      {/* Расходы по категориям */}
      <Card className="mt-4 p-4">
        <h2 className="font-display text-lg font-semibold text-ink mb-4">Расходы по категориям</h2>
        {categoryData.length === 0 ? (
          <p className="text-ink/60 text-center py-8">Нет данных за выбранный период</p>
        ) : (
          <div className="space-y-3">
            {categoryData
              .filter(cat => cat.expense > 0)
              .sort((a, b) => b.expense - a.expense)
              .map((cat) => {
                const percentage = totalExpense > 0 ? (cat.expense / totalExpense) * 100 : 0;
                return (
                  <div key={cat.category}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ink">{cat.category}</span>
                      <span className="font-medium text-ink">{formatCurrency(cat.expense)}</span>
                    </div>
                    <div className="mt-1 h-2 w-full rounded-full bg-ink/10">
                      <div
                        className="h-2 rounded-full bg-red-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </Card>

      {/* Динамика по месяцам */}
      <Card className="mt-4 p-4">
        <h2 className="font-display text-lg font-semibold text-ink mb-4">Динамика по месяцам</h2>
        {monthlyData.length === 0 ? (
          <p className="text-ink/60 text-center py-8">Нет данных</p>
        ) : (
          <div className="space-y-4">
            {monthlyData.map((item) => {
              const maxAmount = Math.max(...monthlyData.map(d => Math.max(d.income, d.expense)));
              const incomeWidth = maxAmount > 0 ? (item.income / maxAmount) * 100 : 0;
              const expenseWidth = maxAmount > 0 ? (item.expense / maxAmount) * 100 : 0;
              
              return (
                <div key={item.month}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-ink font-medium">
                      {new Date(item.month + '-01').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
                    </span>
                    <span className="text-ink/60">
                      {formatCurrency(item.income - item.expense)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="h-2 w-full rounded-full bg-ink/10">
                        <div
                          className="h-2 rounded-full bg-green-500"
                          style={{ width: `${incomeWidth}%` }}
                          title={`Доход: ${formatCurrency(item.income)}`}
                        />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="h-2 w-full rounded-full bg-ink/10">
                        <div
                          className="h-2 rounded-full bg-red-500"
                          style={{ width: `${expenseWidth}%` }}
                          title={`Расход: ${formatCurrency(item.expense)}`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-end gap-4 text-xs text-ink/60 mt-2">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span>Доходы</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span>Расходы</span>
              </div>
            </div>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
