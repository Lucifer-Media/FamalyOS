'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { Card, Button, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';

interface Budget {
  id: string;
  title: string;
  attributes: {
    budgetName: string;
    budgetType: 'MONTHLY' | 'YEARLY' | 'CATEGORY' | 'PROJECT';
    startDate: string;
    endDate?: string;
    currency: string;
    plannedIncome?: number;
    plannedExpense?: number;
    categories?: string;
  };
}

export default function BudgetsPage() {
  const { loading, isAuthenticated, user } = useRequireAuth();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  const [formData, setFormData] = useState({
    budgetName: '',
    budgetType: 'MONTHLY' as 'MONTHLY' | 'YEARLY' | 'CATEGORY' | 'PROJECT',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    currency: 'RUB',
    plannedIncome: '',
    plannedExpense: '',
    categories: '',
    notes: '',
  });

  useEffect(() => {
    if (isAuthenticated) {
      loadBudgets();
    }
  }, [isAuthenticated]);

  const loadBudgets = async () => {
    try {
      setLoadingData(true);
      const data = await api.get(`/finance/budgets?familySpaceId=${user?.familySpaceId}`);
      setBudgets(data);
    } catch (error) {
      console.error('Ошибка загрузки бюджетов:', error);
    } finally {
      setLoadingData(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/finance/budgets', {
        ...formData,
        plannedIncome: formData.plannedIncome ? parseFloat(formData.plannedIncome) : undefined,
        plannedExpense: formData.plannedExpense ? parseFloat(formData.plannedExpense) : undefined,
        familySpaceId: user?.familySpaceId,
      });
      setFormData({
        budgetName: '',
        budgetType: 'MONTHLY',
        startDate: new Date().toISOString().split('T')[0],
        endDate: '',
        currency: 'RUB',
        plannedIncome: '',
        plannedExpense: '',
        categories: '',
        notes: '',
      });
      setShowForm(false);
      loadBudgets();
    } catch (error) {
      console.error('Ошибка создания бюджета:', error);
      alert('Не удалось создать бюджет');
    }
  };

  const formatCurrency = (amount?: number, currency?: string) => {
    if (amount === undefined || amount === null) return '—';
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: currency || 'RUB',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getBudgetTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      MONTHLY: 'Ежемесячный',
      YEARLY: 'Ежегодный',
      CATEGORY: 'По категории',
      PROJECT: 'Проект',
    };
    return labels[type] || type;
  };

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
        <h1 className="font-display text-2xl font-semibold text-ink">Бюджеты</h1>
        <Button onClick={() => setShowForm(!showForm)} variant="primary">
          {showForm ? 'Отмена' : '+ Добавить бюджет'}
        </Button>
      </div>

      {showForm && (
        <Card className="mt-4 p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-ink">Название бюджета</label>
                <Input
                  required
                  value={formData.budgetName}
                  onChange={(e) => setFormData({ ...formData, budgetName: e.target.value })}
                  placeholder="Семейный бюджет"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">Тип бюджета</label>
                <Select
                  value={formData.budgetType}
                  onChange={(e) => setFormData({ ...formData, budgetType: e.target.value as any })}
                >
                  <option value="MONTHLY">Ежемесячный</option>
                  <option value="YEARLY">Ежегодный</option>
                  <option value="CATEGORY">По категории</option>
                  <option value="PROJECT">Проект</option>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">Дата начала</label>
                <Input
                  type="date"
                  required
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">Дата окончания</label>
                <Input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">Валюта</label>
                <Select
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                >
                  <option value="RUB">RUB</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="BYN">BYN</option>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">Планируемый доход</label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.plannedIncome}
                  onChange={(e) => setFormData({ ...formData, plannedIncome: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">Планируемый расход</label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.plannedExpense}
                  onChange={(e) => setFormData({ ...formData, plannedExpense: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-ink">Категории (через запятую)</label>
                <Input
                  value={formData.categories}
                  onChange={(e) => setFormData({ ...formData, categories: e.target.value })}
                  placeholder="Продукты, Транспорт, ЖКХ"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Отмена
              </Button>
              <Button type="submit" variant="primary">
                Создать бюджет
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {budgets.length === 0 ? (
          <Card className="p-6 text-center text-ink/60">
            <p>У вас пока нет бюджетов</p>
            <p className="mt-1 text-sm">Создайте первый бюджет для планирования расходов</p>
          </Card>
        ) : (
          budgets.map((budget) => (
            <Card key={budget.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-display text-lg font-semibold text-ink">
                    {budget.attributes.budgetName}
                  </h3>
                  <p className="text-sm text-ink/60">
                    {getBudgetTypeLabel(budget.attributes.budgetType)}
                  </p>
                  <p className="mt-2 text-xs text-ink/40">
                    {new Date(budget.attributes.startDate).toLocaleDateString('ru-RU')}
                    {budget.attributes.endDate && ` — ${new Date(budget.attributes.endDate).toLocaleDateString('ru-RU')}`}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-sm">
                    <span className="text-ink/60">Доход:</span>{' '}
                    <span className="text-green-600 font-medium">
                      {formatCurrency(budget.attributes.plannedIncome, budget.attributes.currency)}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-ink/60">Расход:</span>{' '}
                    <span className="text-red-600 font-medium">
                      {formatCurrency(budget.attributes.plannedExpense, budget.attributes.currency)}
                    </span>
                  </div>
                </div>
              </div>
              {budget.attributes.categories && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {budget.attributes.categories.split(',').map((cat, idx) => (
                    <span
                      key={idx}
                      className="rounded bg-ink/5 px-2 py-0.5 text-xs text-ink/60"
                    >
                      {cat.trim()}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
