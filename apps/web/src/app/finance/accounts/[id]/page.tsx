'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useEntityTypeSchema } from '@/lib/use-entity-types';
import { DynamicEntityForm } from '@/components/dynamic-entity-form';
import { FinanceSubNav } from '@/components/finance-subnav';
import { BankAvatar } from '@/components/bank-avatar';
import PersonSelect from '@/components/ui/person-select';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Badge } from '@/components/ui';
import { toast } from 'sonner';
import { Upload, ArrowUpRight, ArrowDownLeft, Plus, Pencil, X, Save, Archive, ArchiveRestore, History, Globe, CalendarClock } from 'lucide-react';
import EntityLinkSelect from '@/components/ui/entity-link-select';

interface AccountDetail {
  id: string;
  title: string;
  status: string;
  currentVersion: number;
  ownerPersonId?: string | null;
  attributes: {
    bankId?: string;
    bankName?: string;
    brandColorOverride?: string;
    currency?: string;
    accountType?: string;
    accountNumber?: string;
    linkedCardNumber?: string;
    currentBalance?: number;
    interestRate?: number;
    creditLimit?: number;
    openDate?: string;
    closeDate?: string;
    notes?: string;
  };
}

interface BankDetail {
  id: string;
  attributes: { name?: string; country?: string; website?: string; brandColor?: string; notes?: string };
}

interface VersionEntry {
  versionNumber: number;
  action: string;
  changeSummary: string | null;
  changedAt: string;
}

interface TransactionSummary {
  id: string;
  title: string;
  attributes: {
    date: string;
    amount: number;
    currency: string;
    description: string;
    category?: string;
    categoryId?: string;
    transactionType?: string;
    scope?: string;
    isPlanned?: boolean;
    plannedStatus?: 'PLANNED' | 'COMPLETED' | 'CANCELLED';
  };
}

interface StagedTransaction {
  date: string;
  amount: number;
  currency: string;
  description: string;
  counterparty?: string;
  category?: string;
  externalId: string;
  sourceFormat: string;
  isDuplicate: boolean;
}

interface TransactionFormState {
  date: string;
  amount: string;
  categoryId: string;
  description: string;
  scope: string;
  isPlanned: boolean;
}

export default function AccountDetailPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { schema: accountSchema } = useEntityTypeSchema('bank_account');
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [bank, setBank] = useState<BankDetail | null>(null);
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [staged, setStaged] = useState<StagedTransaction[] | null>(null);
  const [detectedFormat, setDetectedFormat] = useState('');
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Редактирование реквизитов счёта (пункт 2 запроса на доработку).
  const [editingAccount, setEditingAccount] = useState(false);
  const [accountValues, setAccountValues] = useState<Record<string, unknown>>({});
  const [savingAccount, setSavingAccount] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [ownerPersonId, setOwnerPersonId] = useState<string | undefined>(undefined);

  // Ручное добавление / редактирование одной операции — одна и та же форма для обоих случаев.
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<TransactionFormState>({ date: '', amount: '', categoryId: '', description: '', scope: 'FAMILY', isPlanned: false });
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Record<string, string>>({});

  async function load() {
    const [acc, txs, cats] = await Promise.all([
      apiFetch<AccountDetail>(`/entities/${params.id}`),
      apiFetch<TransactionSummary[]>(`/entities?entityType=financial_transaction`),
      apiFetch<{ id: string; title: string }[]>(`/entities?entityType=financial_category`),
    ]);
    setAccount(acc);
    setAccountValues(acc.attributes ?? {});
    setOwnerPersonId(acc.ownerPersonId ?? undefined);
    setTransactions((txs as any).filter((t: any) => t.attributes?.accountId === params.id));
    setCategories(Object.fromEntries(cats.map((c) => [c.id, c.title])));
    if (acc.attributes.bankId) {
      apiFetch<BankDetail>(`/entities/${acc.attributes.bankId}`)
        .then(setBank)
        .catch(() => setBank(null));
    } else {
      setBank(null);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [params.id]);

  async function onSaveAccount() {
    setSavingAccount(true);
    setError('');
    try {
      const updated = await apiFetch<AccountDetail>(`/entities/${params.id}`, {
        method: 'PATCH',
        body: { attributes: accountValues, ownerPersonId },
      });
      setAccount(updated);
      setAccountValues(updated.attributes ?? {});
      setOwnerPersonId(updated.ownerPersonId ?? undefined);
      setEditingAccount(false);
      toast.success('Реквизиты счёта сохранены');
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setError(Array.isArray((e.body as any)?.errors) ? (e.body as any).errors.join('; ') : e.message);
      } else {
        setError(e instanceof ApiError ? e.message : 'Не удалось сохранить реквизиты');
      }
    } finally {
      setSavingAccount(false);
    }
  }

  async function onToggleArchive() {
    if (!account) return;
    setArchiveBusy(true);
    try {
      const nextAction = account.status === 'ARCHIVED' ? 'unarchive' : 'archive';
      const updated = await apiFetch<AccountDetail>(`/entities/${params.id}/${nextAction}`, { method: 'PATCH' });
      setAccount(updated);
      toast.success(nextAction === 'archive' ? 'Счёт архивирован' : 'Счёт восстановлен из архива');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось изменить статус счёта');
    } finally {
      setArchiveBusy(false);
    }
  }

  async function loadVersions() {
    const v = await apiFetch<VersionEntry[]>(`/entities/${params.id}/versions`);
    setVersions(v);
    setShowVersions((s) => !s);
  }

  async function onUploadStatement(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await apiFetch<{ detectedFormat: string; warnings: string[]; transactions: StagedTransaction[] }>(
        `/finance/import/${params.id}/parse`,
        { method: 'POST', body: form, isForm: true },
      );
      setDetectedFormat(result.detectedFormat);
      setStaged(result.transactions);
      if (result.transactions.length === 0) {
        setError(result.warnings.join('; ') || 'В файле не найдено операций');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось разобрать файл выписки');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function onConfirmImport() {
    if (!staged) return;
    setConfirming(true);
    setError('');
    try {
      const toImport = staged.filter((t) => !t.isDuplicate);
      const result = await apiFetch<{ created: number; skippedDuplicates: number }>('/finance/import/confirm', {
        method: 'POST',
        body: { accountEntityId: params.id, transactions: toImport },
      });
      setStaged(null);
      await load();
      toast.success(`Импортировано операций: ${result.created}`, {
        description: result.skippedDuplicates > 0 ? `Пропущено дублей: ${result.skippedDuplicates}` : undefined,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось подтвердить импорт');
    } finally {
      setConfirming(false);
    }
  }

  function openNewTransaction() {
    setForm({ date: new Date().toISOString().slice(0, 10), amount: '', categoryId: '', description: '', scope: 'FAMILY', isPlanned: false });
    setEditingId('new');
  }

  function openEditTransaction(t: TransactionSummary) {
    setForm({
      date: t.attributes.date,
      amount: String(t.attributes.amount),
      categoryId: t.attributes.categoryId ?? '',
      description: t.attributes.description ?? '',
      scope: t.attributes.scope ?? 'FAMILY',
      isPlanned: t.attributes.isPlanned === true,
    });
    setEditingId(t.id);
  }

  async function onSaveTransaction() {
    if (!account) return;
    setSaving(true);
    setError('');
    try {
      const amount = Number(form.amount);
      if (!form.date || Number.isNaN(amount)) {
        setError('Укажите дату и корректную сумму (отрицательная — расход, положительная — доход)');
        setSaving(false);
        return;
      }
      const attributes = {
        date: form.date,
        amount,
        currency: account.attributes.currency ?? 'RUB',
        accountId: params.id,
        description: form.description || (amount < 0 ? 'Расход' : 'Доход'),
        categoryId: form.categoryId || undefined,
        // Текстовое поле категории поддерживается для обратной совместимости
        // со старыми бюджетами/аналитикой, которые ещё матчатся по тексту.
        category: form.categoryId ? categories[form.categoryId] : undefined,
        scope: form.scope || undefined,
        transactionType: amount < 0 ? 'EXPENSE' : 'INCOME',
        source: 'MANUAL',
        isPlanned: form.isPlanned,
        plannedStatus: form.isPlanned ? 'PLANNED' : undefined,
      };
      if (editingId === 'new') {
        await apiFetch('/entities', {
          method: 'POST',
          body: { entityType: 'financial_transaction', title: `${form.date}: ${attributes.description}`, attributes },
        });
      } else if (editingId) {
        await apiFetch(`/entities/${editingId}`, {
          method: 'PATCH',
          body: { attributes },
        });
      }
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить операцию');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !isAuthenticated) return null;

  const newCount = staged?.filter((t) => !t.isDuplicate).length ?? 0;
  const dupCount = staged?.filter((t) => t.isDuplicate).length ?? 0;

  return (
    <AppShell>
      <button onClick={() => router.push('/finance')} className="mb-3 text-sm text-ink/50 hover:underline">
        ← К списку счетов
      </button>

      <FinanceSubNav active="/finance" />

      {!account && !error && <p className="mt-4 text-sm text-ink/50">Загрузка…</p>}
      <ErrorText>{error}</ErrorText>

      {account && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <BankAvatar
                bankName={bank?.attributes.name ?? account.attributes.bankName}
                brandColor={account.attributes.brandColorOverride ?? bank?.attributes.brandColor}
                size={44}
              />
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-xl font-semibold text-ink">{account.title}</h1>
                  {account.status === 'ARCHIVED' && <Badge tone="gold">В архиве</Badge>}
                </div>
                {typeof account.attributes.currentBalance === 'number' && (
                  <p className="text-sm text-ink/60">
                    {account.attributes.currentBalance.toLocaleString('ru-RU')} {account.attributes.currency}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={loadVersions}>
                <History size={16} /> Версии (v{account.currentVersion})
              </Button>
              <Button variant="secondary" onClick={onToggleArchive} disabled={archiveBusy}>
                {account.status === 'ARCHIVED' ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                {account.status === 'ARCHIVED' ? 'Восстановить' : 'Архивировать'}
              </Button>
              <Button variant="secondary" onClick={openNewTransaction}>
                <Plus size={16} /> Добавить операцию
              </Button>
              <input ref={fileInputRef} type="file" accept=".ofx,.csv,.xlsx,.xls" className="hidden" onChange={onUploadStatement} />
              <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload size={16} /> {uploading ? 'Разбираем…' : 'Импортировать выписку'}
              </Button>
            </div>
          </div>

          <Card className="mt-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Реквизиты и информация о счёте</h2>
              {!editingAccount ? (
                <Button variant="secondary" onClick={() => setEditingAccount(true)}>
                  <Pencil size={16} /> Редактировать
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button onClick={onSaveAccount} disabled={savingAccount}>
                    <Save size={16} /> {savingAccount ? 'Сохраняем…' : 'Сохранить'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setAccountValues(account.attributes);
                      setOwnerPersonId(account.ownerPersonId ?? undefined);
                      setEditingAccount(false);
                    }}
                  >
                    <X size={16} /> Отмена
                  </Button>
                </div>
              )}
            </div>
            {accountSchema && (
              <div className="mt-3">
                <DynamicEntityForm
                  schema={accountSchema}
                  values={accountValues}
                  onChange={(k, v) => setAccountValues((s) => ({ ...s, [k]: v }))}
                  disabled={!editingAccount}
                />
                <div className="mt-3 max-w-xs">
                  <label className="mb-1 block text-xs text-ink/50">Владелец счёта (участник семьи)</label>
                  <PersonSelect value={ownerPersonId} onChange={setOwnerPersonId} disabled={!editingAccount} />
                </div>
              </div>
            )}
            {bank && (
              <div className="mt-4 flex items-center gap-2 border-t border-line pt-3 text-sm text-ink/60">
                <BankAvatar bankName={bank.attributes.name} brandColor={bank.attributes.brandColor} size={24} />
                <span>{bank.attributes.name}</span>
                {bank.attributes.country && <span>· {bank.attributes.country}</span>}
                {bank.attributes.website && (
                  <a
                    href={bank.attributes.website.startsWith('http') ? bank.attributes.website : `https://${bank.attributes.website}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-moss-600 hover:underline"
                  >
                    <Globe size={14} /> сайт банка
                  </a>
                )}
              </div>
            )}
          </Card>

          {showVersions && (
            <Card className="mt-4">
              <h3 className="font-display text-lg font-semibold">История изменений счёта</h3>
              <ul className="mt-2 divide-y divide-line">
                {versions.map((v) => (
                  <li key={v.versionNumber} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      <span className="font-medium">v{v.versionNumber}</span> — {v.action} ·{' '}
                      <span className="text-ink/50">{new Date(v.changedAt).toLocaleString('ru-RU')}</span>
                    </span>
                  </li>
                ))}
                {versions.length === 0 && <p className="py-2 text-sm text-ink/50">История пуста.</p>}
              </ul>
            </Card>
          )}

          {editingId && (
            <Card className="animate-in mt-4">
              <h2 className="font-display text-lg font-semibold">
                {editingId === 'new' ? 'Новая операция' : 'Редактирование операции'}
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-ink/50">Дата</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ink/50">Сумма (отрицательная — расход)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
                    placeholder="-1500 или 50000"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ink/50">Категория</label>
                  <EntityLinkSelect
                    entityType="financial_category"
                    value={form.categoryId || undefined}
                    onChange={(id) => setForm((f) => ({ ...f, categoryId: id ?? '' }))}
                    placeholder="Начните ввод для поиска категории…"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ink/50">Описание</label>
                  <input
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ink/50">Тип расхода</label>
                  <select
                    value={form.scope}
                    onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
                    className="w-full rounded-card border border-line bg-paper px-3 py-1.5 text-sm"
                  >
                    <option value="FAMILY">Семейный</option>
                    <option value="PERSONAL">Личный</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 pt-6 text-sm text-ink/80">
                  <input
                    type="checkbox"
                    checked={form.isPlanned}
                    onChange={(e) => setForm((f) => ({ ...f, isPlanned: e.target.checked }))}
                    className="h-4 w-4 rounded border-line"
                  />
                  <CalendarClock size={14} className="text-ink/40" />
                  Плановая операция (ещё не произошла по факту)
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <Button onClick={onSaveTransaction} disabled={saving}>
                  {saving ? 'Сохраняем…' : 'Сохранить'}
                </Button>
                <Button variant="secondary" onClick={() => setEditingId(null)}>
                  Отмена
                </Button>
              </div>
            </Card>
          )}

          {staged && (
            <Card className="animate-in mt-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold">Предпросмотр импорта</h2>
                <Badge tone="moss">{detectedFormat}</Badge>
              </div>
              <p className="mt-1 text-sm text-ink/60">
                Новых операций: <strong>{newCount}</strong>, уже импортировано ранее (пропускаются):{' '}
                <strong>{dupCount}</strong> из {staged.length} всего.
              </p>
              <div className="mt-3 max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {staged.slice(0, 200).map((t, i) => (
                      <tr key={i} className={t.isDuplicate ? 'opacity-40' : ''}>
                        <td className="py-1 pr-2 whitespace-nowrap">{t.date}</td>
                        <td className={`py-1 pr-2 text-right whitespace-nowrap ${t.amount < 0 ? 'text-clay' : 'text-moss-600'}`}>
                          {t.amount > 0 ? '+' : ''}
                          {t.amount} {t.currency}
                        </td>
                        <td className="py-1 pr-2 truncate">{t.description}</td>
                        <td className="py-1">{t.isDuplicate && <Badge tone="gold">дубль</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex gap-2">
                <Button onClick={onConfirmImport} disabled={confirming || newCount === 0}>
                  {confirming ? 'Импортируем…' : `Импортировать ${newCount} операций`}
                </Button>
                <Button variant="secondary" onClick={() => setStaged(null)}>
                  Отмена
                </Button>
              </div>
            </Card>
          )}

          <Card className="mt-4">
            <h2 className="font-display text-lg font-semibold">Операции</h2>
            <div className="mt-2 divide-y divide-line">
              {transactions
                .sort((a, b) => (a.attributes.date < b.attributes.date ? 1 : -1))
                .map((t) => (
                  <div key={t.id} className="group flex items-center justify-between py-2 text-sm">
                    <div className="flex items-center gap-2">
                      {t.attributes.amount < 0 ? (
                        <ArrowUpRight size={14} className="text-clay" />
                      ) : (
                        <ArrowDownLeft size={14} className="text-moss-600" />
                      )}
                      <div>
                        <p className="flex items-center gap-1.5 text-ink">
                          {t.attributes.description}
                          {t.attributes.isPlanned && (t.attributes.plannedStatus ?? 'PLANNED') === 'PLANNED' && (
                            <Badge tone="gold">план</Badge>
                          )}
                        </p>
                        <p className="text-xs text-ink/40">
                          {t.attributes.date}
                          {(t.attributes.categoryId ? categories[t.attributes.categoryId] : t.attributes.category) &&
                            ` · ${t.attributes.categoryId ? categories[t.attributes.categoryId] : t.attributes.category}`}
                          {t.attributes.scope === 'PERSONAL' && ' · личный'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className={t.attributes.amount < 0 ? 'text-clay' : 'text-moss-600'}>
                        {t.attributes.amount > 0 ? '+' : ''}
                        {t.attributes.amount} {t.attributes.currency}
                      </p>
                      <button
                        onClick={() => openEditTransaction(t)}
                        className="opacity-0 transition-opacity hover:text-clay group-hover:opacity-100"
                        title="Редактировать"
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              {transactions.length === 0 && <p className="py-2 text-sm text-ink/50">Операций пока нет.</p>}
            </div>
          </Card>
        </>
      )}
    </AppShell>
  );
}
