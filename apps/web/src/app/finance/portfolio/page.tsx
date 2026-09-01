'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { FinanceSubNav } from '@/components/finance-subnav';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Badge } from '@/components/ui';
import { toast } from 'sonner';
import { Plus, Landmark, TrendingUp, HandCoins, Wallet, ChevronRight } from 'lucide-react';

interface NetWorth {
  cashBalance: number;
  investmentsValue: number;
  loansBalance: number;
  debtsIOwe: number;
  debtsOwedToMe: number;
  netWorth: number;
}

interface LoanEntity {
  id: string;
  title: string;
  status: string;
  attributes: {
    lenderName?: string;
    loanType?: string;
    currency?: string;
    principalAmount?: number;
    currentBalance?: number;
    interestRate?: number;
    monthlyPayment?: number;
  };
}

interface InvestmentEntity {
  id: string;
  title: string;
  status: string;
  attributes: {
    name?: string;
    investmentType?: string;
    currency?: string;
    initialAmount?: number;
    currentValue?: number;
    expectedAnnualReturnPercent?: number;
  };
}

interface DebtEntity {
  id: string;
  title: string;
  status: string;
  attributes: {
    counterpartyName?: string;
    direction?: 'I_OWE' | 'OWED_TO_ME';
    currency?: string;
    originalAmount?: number;
    remainingAmount?: number;
    dueDate?: string;
  };
}

type CreatingSection = 'loan' | 'investment' | 'debt' | null;

function fmt(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

/** Прогноз по сложным процентам — тот же расчёт, что и на backend (forecastInvestment), для мгновенного предпросмотра без похода на сервер. */
function forecastLocal(currentValue: number, baseRate: number, years: number) {
  const compound = (rate: number) => Math.round(currentValue * Math.pow(1 + rate / 100, years));
  return { pessimistic: compound(Math.max(0, baseRate - 5)), base: compound(baseRate), optimistic: compound(baseRate + 5) };
}

export default function PortfolioPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { schema: loanSchema } = useEntityTypeSchema('loan_account');
  const { schema: investmentSchema } = useEntityTypeSchema('investment_account');
  const { schema: debtSchema } = useEntityTypeSchema('debt');

  const [netWorth, setNetWorth] = useState<NetWorth | null>(null);
  const [loans, setLoans] = useState<LoanEntity[]>([]);
  const [investments, setInvestments] = useState<InvestmentEntity[]>([]);
  const [debts, setDebts] = useState<DebtEntity[]>([]);
  const [error, setError] = useState('');

  const [creating, setCreating] = useState<CreatingSection>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [forecastYears, setForecastYears] = useState(5);

  async function load() {
    const [nw, loanList, investmentList, debtList] = await Promise.all([
      apiFetch<NetWorth>('/finance/portfolio/net-worth'),
      apiFetch<LoanEntity[]>('/entities?entityType=loan_account&status=ACTIVE'),
      apiFetch<InvestmentEntity[]>('/entities?entityType=investment_account&status=ACTIVE'),
      apiFetch<DebtEntity[]>('/entities?entityType=debt&status=ACTIVE'),
    ]);
    setNetWorth(nw);
    setLoans(loanList);
    setInvestments(investmentList);
    setDebts(debtList);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  function openCreate(section: CreatingSection) {
    setValues({});
    setCreating(section);
  }

  async function onCreate() {
    if (!creating) return;
    const entityType = creating === 'loan' ? 'loan_account' : creating === 'investment' ? 'investment_account' : 'debt';
    const titleValue =
      creating === 'loan'
        ? (values.lenderName as string) || 'Кредит'
        : creating === 'investment'
          ? (values.name as string) || 'Вклад'
          : (values.counterpartyName as string) || 'Долг';
    setSaving(true);
    setError('');
    try {
      await apiFetch('/entities', { method: 'POST', body: { entityType, title: titleValue, attributes: values } });
      setCreating(null);
      setValues({});
      await load();
      toast.success('Запись добавлена');
    } catch (e) {
      setError(e instanceof ApiError ? (Array.isArray((e.body as any)?.errors) ? (e.body as any).errors.join('; ') : e.message) : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  async function onRecordDebtRepayment(debt: DebtEntity, amount: number) {
    if (amount <= 0) return;
    const remaining = Math.max(0, (debt.attributes.remainingAmount ?? 0) - amount);
    try {
      await apiFetch(`/entities/${debt.id}`, { method: 'PATCH', body: { attributes: { remainingAmount: remaining } } });
      toast.success(remaining === 0 ? 'Долг полностью погашен' : 'Частичное погашение учтено');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось обновить остаток долга');
    }
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Портфель</h1>
        <p className="mt-1 text-sm text-ink/60">Кредиты, вклады, долги и Net Worth семьи в реальном времени.</p>
      </div>

      <div className="mt-4">
        <FinanceSubNav active="/finance/portfolio" />
      </div>

      <ErrorText>{error}</ErrorText>

      {netWorth && (
        <Card className="mt-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Net Worth семьи</h2>
            <p className={`font-display text-2xl font-semibold ${netWorth.netWorth < 0 ? 'text-clay' : 'text-moss-600'}`}>{fmt(netWorth.netWorth)} ₽</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div>
              <p className="text-xs text-ink/50">Наличные на счетах</p>
              <p className="font-medium text-ink">{fmt(netWorth.cashBalance)} ₽</p>
            </div>
            <div>
              <p className="text-xs text-ink/50">Вклады/инвестиции</p>
              <p className="font-medium text-ink">{fmt(netWorth.investmentsValue)} ₽</p>
            </div>
            <div>
              <p className="text-xs text-ink/50">Кредиты (долг)</p>
              <p className="font-medium text-clay">-{fmt(netWorth.loansBalance)} ₽</p>
            </div>
            <div>
              <p className="text-xs text-ink/50">Я должен</p>
              <p className="font-medium text-clay">-{fmt(netWorth.debtsIOwe)} ₽</p>
            </div>
            <div>
              <p className="text-xs text-ink/50">Мне должны</p>
              <p className="font-medium text-moss-600">+{fmt(netWorth.debtsOwedToMe)} ₽</p>
            </div>
          </div>
        </Card>
      )}

      {/* ---------- Кредиты и ипотека ---------- */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <Landmark size={18} className="text-ink/40" /> Кредиты и ипотека
        </h2>
        <Button variant="secondary" onClick={() => openCreate('loan')} disabled={!loanSchema}>
          <Plus size={16} /> Добавить
        </Button>
      </div>
      {creating === 'loan' && loanSchema && (
        <Card className="animate-in mt-3">
          <DynamicEntityForm schema={loanSchema} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
          <div className="mt-3 flex gap-2">
            <Button onClick={onCreate} disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            <Button variant="secondary" onClick={() => setCreating(null)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {loans.map((loan) => (
          <Link key={loan.id} href={`/finance/portfolio/loans/${loan.id}`}>
            <Card className="flex items-center justify-between gap-2 transition-shadow hover:shadow-md">
              <div>
                <p className="font-medium text-ink">{loan.title}</p>
                <p className="text-xs text-ink/50">
                  Остаток {fmt(loan.attributes.currentBalance ?? 0)} {loan.attributes.currency} · {loan.attributes.interestRate}% годовых
                </p>
              </div>
              <ChevronRight size={16} className="shrink-0 text-ink/30" />
            </Card>
          </Link>
        ))}
        {loans.length === 0 && creating !== 'loan' && <p className="text-sm text-ink/50">Кредитов пока нет.</p>}
      </div>

      {/* ---------- Вклады и инвестиции ---------- */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <TrendingUp size={18} className="text-ink/40" /> Вклады и инвестиции
        </h2>
        <Button variant="secondary" onClick={() => openCreate('investment')} disabled={!investmentSchema}>
          <Plus size={16} /> Добавить
        </Button>
      </div>
      {creating === 'investment' && investmentSchema && (
        <Card className="animate-in mt-3">
          <DynamicEntityForm schema={investmentSchema} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
          <div className="mt-3 flex gap-2">
            <Button onClick={onCreate} disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            <Button variant="secondary" onClick={() => setCreating(null)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}
      <div className="mt-3 space-y-3">
        <div className="flex items-center gap-2 text-xs text-ink/50">
          Прогноз на
          <select
            value={forecastYears}
            onChange={(e) => setForecastYears(Number(e.target.value))}
            className="rounded-card border border-line bg-paper px-2 py-1"
          >
            {[1, 3, 5, 10].map((y) => (
              <option key={y} value={y}>
                {y} {y === 1 ? 'год' : y < 5 ? 'года' : 'лет'}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {investments.map((inv) => {
            const value = inv.attributes.currentValue ?? 0;
            const rate = inv.attributes.expectedAnnualReturnPercent ?? 0;
            const forecast = rate ? forecastLocal(value, rate, forecastYears) : null;
            return (
              <Card key={inv.id}>
                <p className="font-medium text-ink">{inv.title}</p>
                <p className="text-xs text-ink/50">
                  {fmt(value)} {inv.attributes.currency} {rate ? `· ${rate}% годовых` : ''}
                </p>
                {forecast && (
                  <div className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">
                    <div className="rounded-card bg-paper-dim p-1.5">
                      <p className="text-ink/40">Пессимист.</p>
                      <p className="font-medium text-clay">{fmt(forecast.pessimistic)}</p>
                    </div>
                    <div className="rounded-card bg-paper-dim p-1.5">
                      <p className="text-ink/40">База</p>
                      <p className="font-medium text-ink">{fmt(forecast.base)}</p>
                    </div>
                    <div className="rounded-card bg-paper-dim p-1.5">
                      <p className="text-ink/40">Оптимист.</p>
                      <p className="font-medium text-moss-600">{fmt(forecast.optimistic)}</p>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
          {investments.length === 0 && creating !== 'investment' && <p className="text-sm text-ink/50">Вкладов и инвестиций пока нет.</p>}
        </div>
      </div>

      {/* ---------- Долги ---------- */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <HandCoins size={18} className="text-ink/40" /> Долги
        </h2>
        <Button variant="secondary" onClick={() => openCreate('debt')} disabled={!debtSchema}>
          <Plus size={16} /> Добавить
        </Button>
      </div>
      {creating === 'debt' && debtSchema && (
        <Card className="animate-in mt-3">
          <DynamicEntityForm schema={debtSchema} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
          <div className="mt-3 flex gap-2">
            <Button onClick={onCreate} disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            <Button variant="secondary" onClick={() => setCreating(null)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}
      <div className="mt-3 space-y-2">
        {debts.map((debt) => (
          <DebtRow key={debt.id} debt={debt} onRepay={(amount) => onRecordDebtRepayment(debt, amount)} />
        ))}
        {debts.length === 0 && creating !== 'debt' && <p className="text-sm text-ink/50">Долгов не зафиксировано.</p>}
      </div>
    </AppShell>
  );
}

function DebtRow({ debt, onRepay }: { debt: DebtEntity; onRepay: (amount: number) => void }) {
  const [amount, setAmount] = useState('');
  const isIOwe = debt.attributes.direction === 'I_OWE';
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 font-medium text-ink">
            {debt.title}
            <Badge tone={isIOwe ? 'clay' : 'moss'}>{isIOwe ? 'Я должен' : 'Мне должны'}</Badge>
          </p>
          <p className="text-xs text-ink/50">
            Остаток {fmt(debt.attributes.remainingAmount ?? 0)} {debt.attributes.currency} из {fmt(debt.attributes.originalAmount ?? 0)}
            {debt.attributes.dueDate && ` · до ${debt.attributes.dueDate}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Сумма"
            className="w-24 rounded-card border border-line bg-paper px-2 py-1 text-sm"
          />
          <Button
            variant="secondary"
            onClick={() => {
              onRepay(Number(amount) || 0);
              setAmount('');
            }}
          >
            <Wallet size={14} /> Погашение
          </Button>
        </div>
      </div>
    </Card>
  );
}
