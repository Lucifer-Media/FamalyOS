'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { Card, Button, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';

interface BankAccount {
  id: string;
  title: string;
  attributes: {
    accountName: string;
    bankName: string;
    accountNumber: string;
    currency: string;
    accountType: string;
    currentBalance?: number;
    openingDate?: string;
  };
  createdAt: string;
}

export default function AccountsPage() {
  const { loading, isAuthenticated, user } = useRequireAuth();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  const [formData, setFormData] = useState({
    accountName: '',
    bankName: '',
    accountNumber: '',
    currency: 'RUB',
    accountType: 'CHECKING',
    currentBalance: '',
    openingDate: '',
    notes: '',
  });

  useEffect(() => {
    if (isAuthenticated) {
      loadAccounts();
    }
  }, [isAuthenticated]);

  const loadAccounts = async () => {
    try {
      setLoadingData(true);
      const data = await api.get('/finance/accounts');
      setAccounts(data);
    } catch (error) {
      console.error('Ошибка загрузки счетов:', error);
    } finally {
      setLoadingData(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/finance/accounts', {
        ...formData,
        currentBalance: formData.currentBalance ? parseFloat(formData.currentBalance) : undefined,
        familySpaceId: user?.familySpaceId,
      });
      setFormData({
        accountName: '',
        bankName: '',
        accountNumber: '',
        currency: 'RUB',
        accountType: 'CHECKING',
        currentBalance: '',
        openingDate: '',
        notes: '',
      });
      setShowForm(false);
      loadAccounts();
    } catch (error) {
      console.error('Ошибка создания счёта:', error);
      alert('Не удалось создать счёт');
    }
  };

  const formatCurrency = (amount?: number, currency?: string) => {
    if (amount === undefined || amount === null) return '—';
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: currency || 'RUB',
    }).format(amount);
  };

  const getAccountTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      CHECKING: 'Расчётный',
      SAVINGS: 'Сберегательный',
      CREDIT: 'Кредитный',
      DEPOSIT: 'Вклад',
      CARD: 'Карточный',
      OTHER: 'Другой',
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
        <h1 className="font-display text-2xl font-semibold text-ink">Банковские счета</h1>
        <Button onClick={() => setShowForm(!showForm)} variant="primary">
          {showForm ? 'Отмена' : '+ Добавить счёт'}
        </Button>
      </div>

      {showForm && (
        <Card className="mt-4 p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-ink">Название счёта</label>
                <Input
                  required
                  value={formData.accountName}
                  onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
                  placeholder="Основной счёт"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">Банк</label>
                <Input
                  required
                  value={formData.bankName}
                  onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                  placeholder="Сбербанк"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">Номер счёта</label>
                <Input
                  required
                  value={formData.accountNumber}
                  onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                  placeholder="40817..."
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
                  <option value="CNY">CNY</option>
                  <option value="GBP">GBP</option>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">Тип счёта</label>
                <Select
                  value={formData.accountType}
                  onChange={(e) => setFormData({ ...formData, accountType: e.target.value })}
                >
                  <option value="CHECKING">Расчётный</option>
                  <option value="SAVINGS">Сберегательный</option>
                  <option value="CREDIT">Кредитный</option>
                  <option value="DEPOSIT">Вклад</option>
                  <option value="CARD">Карточный</option>
                  <option value="OTHER">Другой</option>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">Текущий баланс</label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.currentBalance}
                  onChange={(e) => setFormData({ ...formData, currentBalance: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">Дата открытия</label>
                <Input
                  type="date"
                  value={formData.openingDate}
                  onChange={(e) => setFormData({ ...formData, openingDate: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink">Заметки</label>
              <Input
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Комментарий к счёту"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Отмена
              </Button>
              <Button type="submit" variant="primary">
                Создать счёт
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {accounts.length === 0 ? (
          <Card className="p-6 text-center text-ink/60">
            <p>У вас пока нет банковских счетов</p>
            <p className="mt-1 text-sm">Добавьте первый счёт, чтобы начать учёт</p>
          </Card>
        ) : (
          accounts.map((account) => (
            <Card key={account.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-display text-lg font-semibold text-ink">
                    {account.attributes.accountName}
                  </h3>
                  <p className="text-sm text-ink/60">{account.attributes.bankName}</p>
                  <p className="mt-2 text-xs text-ink/40 font-mono">
                    № {account.attributes.accountNumber}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-ink">
                    {formatCurrency(account.attributes.currentBalance, account.attributes.currency)}
                  </p>
                  <p className="text-sm text-ink/60">{account.attributes.currency}</p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t pt-3">
                <span className="text-xs text-ink/60">
                  {getAccountTypeLabel(account.attributes.accountType)}
                </span>
                {account.attributes.openingDate && (
                  <span className="text-xs text-ink/40">
                    Открыт: {new Date(account.attributes.openingDate).toLocaleDateString('ru-RU')}
                  </span>
                )}
              </div>
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
