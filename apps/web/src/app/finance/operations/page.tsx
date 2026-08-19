'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { Card, Button, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';

interface FinancialOperation {
  id: string;
  title: string;
  attributes: {
    operationDate: string;
    amount: number;
    currency: string;
    operationType: 'INCOME' | 'EXPENSE' | 'TRANSFER';
    category?: string;
    description?: string;
    merchantName?: string;
    sourceAccountId?: string;
    targetAccountId?: string;
  };
}

interface BankAccount {
  id: string;
  attributes: {
    accountName: string;
    currency: string;
  };
}

const CATEGORIES = [
  'Продукты',
  'Рестораны',
  'Транспорт',
  'ЖКХ',
  'Связь',
  'Развлечения',
  'Здоровье',
  'Одежда',
  'Дом',
  'Образование',
  'Зарплата',
  'Инвестиции',
  'Подарки',
  'Другое',
];

export default function OperationsPage() {
  const { loading, isAuthenticated, user } = useRequireAuth();
  const [operations, setOperations] = useState<FinancialOperation[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [filter, setFilter] = useState({
    type: '',
    category: '',
    accountId: '',
  });

  const [formData, setFormData] = useState({
    operationDate: new Date().toISOString().split('T')[0],
    amount: '',
    currency: 'RUB',
    operationType: 'EXPENSE' as 'INCOME' | 'EXPENSE' | 'TRANSFER',
    category: '',
    description: '',
    merchantName: '',
    sourceAccountId: '',
    targetAccountId: '',
    notes: '',
  });

  useEffect(() => {
    if (isAuthenticated) {
      loadOperations();
      loadAccounts();
    }
  }, [isAuthenticated]);

  const loadOperations = async () => {
    try {
      setLoadingData(true);
      const params = new URLSearchParams();
      if (filter.type) params.append('operationType', filter.type);
      if (filter.category) params.append('category', filter.category);
      if (filter.accountId) params.append('accountId', filter.accountId);
      
      const data = await api.get(`/finance/operations?${params.toString()}`);
      setOperations(data);
    } catch (error) {
      console.error('Ошибка загрузки операций:', error);
    } finally {
      setLoadingData(false);
    }
  };

  const loadAccounts = async () => {
    try {
      const data = await api.get('/finance/accounts');
      setAccounts(data);
    } catch (error) {
      console.error('Ошибка загрузки счетов:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/finance/operations', {
        ...formData,
        amount: parseFloat(formData.amount),
        familySpaceId: user?.familySpaceId,
      });
      setFormData({
        operationDate: new Date().toISOString().split('T')[0],
        amount: '',
        currency: 'RUB',
        operationType: 'EXPENSE',
        category: '',
        description: '',
        merchantName: '',
        sourceAccountId: '',
        targetAccountId: '',
        notes: '',
      });
      setShowForm(false);
      loadOperations();
    } catch (error) {
      console.error('Ошибка создания операции:', error);
      alert('Не удалось создать операцию');
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
    }).format(amount);
  };

  const getOperationTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      INCOME: 'Доход',
      EXPENSE: 'Расход',
      TRANSFER: 'Перевод',
    };
    return labels[type] || type;
  };

  const getOperationTypeColor = (type: string) => {
    if (type === 'INCOME') return 'text-green-600';
    if (type === 'EXPENSE') return 'text-red-600';
    return 'text-blue-600';
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
        <h1 className="font-display text-2xl font-semibold text-ink">Финансовые операции</h1>
        <div className="flex gap-2">
          <Button onClick={() => setShowForm(!showForm)} variant="primary">
            {showForm ? 'Отмена' : '+ Добавить операцию'}
          </Button>
          <a href="/finance/import">
            <Button variant="outline">Импорт</Button>
          </a>
        </div>
      </div>

      {/* Фильтры */}
      <Card className="mt-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            value={filter.type}
            onChange={(e) => setFilter({ ...filter, type: e.target.value })}
          >
            <option value="">Все типы</option>
            <option value="INCOME">Доходы</option>
            <option value="EXPENSE">Расходы</option>
            <option value="TRANSFER">Переводы</option>
          </Select>
          <Select
            value={filter.category}
            onChange={(e) => setFilter({ ...filter, category: e.target.value })}
          >
            <option value="">Все категории</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </Select>
          <Button onClick={loadOperations} variant="outline">Применить фильтры</Button>
        </div>
      </Card>

      {showForm && (
        <Card className="mt-4 p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-ink">Дата операции</label>
                <Input
                  type="date"
                  required
                  value={formData.operationDate}
                  onChange={(e) => setFormData({ ...formData, operationDate: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">Тип операции</label>
                <Select
                  value={formData.operationType}
                  onChange={(e) => setFormData({ ...formData, operationType: e.target.value as any })}
                >
                  <option value="EXPENSE">Расход</option>
                  <option value="INCOME">Доход</option>
                  <option value="TRANSFER">Перевод</option>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">Сумма</label>
                <Input
                  type="number"
                  step="0.01"
                  required
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0.00"
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
                <label className="block text-sm font-medium text-ink">Категория</label>
                <Select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                >
                  <option value="">Без категории</option>
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </Select>
              </div>
              {formData.operationType !== 'INCOME' && (
                <div>
                  <label className="block text-sm font-medium text-ink">Счёт списания</label>
                  <Select
                    value={formData.sourceAccountId}
                    onChange={(e) => setFormData({ ...formData, sourceAccountId: e.target.value })}
                  >
                    <option value="">Не выбрано</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.attributes.accountName} ({acc.attributes.currency})
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {formData.operationType === 'TRANSFER' && (
                <div>
                  <label className="block text-sm font-medium text-ink">Счёт зачисления</label>
                  <Select
                    value={formData.targetAccountId}
                    onChange={(e) => setFormData({ ...formData, targetAccountId: e.target.value })}
                  >
                    <option value="">Не выбрано</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.attributes.accountName} ({acc.attributes.currency})
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-ink">Продавец / Получатель</label>
              <Input
                value={formData.merchantName}
                onChange={(e) => setFormData({ ...formData, merchantName: e.target.value })}
                placeholder="Магазин, организация..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink">Описание</label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Комментарий к операции"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Отмена
              </Button>
              <Button type="submit" variant="primary">
                Создать операцию
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Список операций */}
      <div className="mt-6 space-y-2">
        {operations.length === 0 ? (
          <Card className="p-6 text-center text-ink/60">
            <p>Операций не найдено</p>
            <p className="mt-1 text-sm">Добавьте первую операцию или импортируйте выписку из банка</p>
          </Card>
        ) : (
          operations.map((op) => (
            <Card key={op.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className={`font-medium ${getOperationTypeColor(op.attributes.operationType)}`}>
                      {getOperationTypeLabel(op.attributes.operationType)}
                    </span>
                    {op.attributes.category && (
                      <span className="rounded bg-ink/5 px-2 py-0.5 text-xs text-ink/60">
                        {op.attributes.category}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink/60">
                    {new Date(op.attributes.operationDate).toLocaleDateString('ru-RU')}
                    {op.attributes.merchantName && ` • ${op.attributes.merchantName}`}
                    {op.attributes.description && ` • ${op.attributes.description}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-lg font-semibold ${getOperationTypeColor(op.attributes.operationType)}`}>
                    {op.attributes.operationType === 'EXPENSE' ? '-' : '+'}
                    {formatCurrency(op.attributes.amount, op.attributes.currency)}
                  </p>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
