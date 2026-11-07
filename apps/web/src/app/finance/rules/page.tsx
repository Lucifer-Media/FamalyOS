'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { FinanceSubNav } from '@/components/finance-subnav';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, Badge, ErrorText } from '@/components/ui';
import { money, ruDate, inputClass } from '@/lib/finance-format';
import { toast } from 'sonner';
import { Plus, Trash2, Wand2, Play, Eye, Pencil, Archive, Sparkles, Loader2, Check } from 'lucide-react';

type Field = 'description' | 'counterparty' | 'mcc' | 'amount' | 'accountId' | 'bankCategory';
type Op = 'contains' | 'equals' | 'startsWith' | 'regex' | 'gt' | 'lt';
interface Condition {
  field: Field;
  op: Op;
  value: string;
}
interface RuleAttrs {
  name: string;
  isActive?: boolean;
  priority?: number;
  matchMode?: 'ALL' | 'ANY';
  conditions: Condition[];
  setCategoryId?: string;
  setScope?: string;
  setTransactionType?: string;
  setCounterparty?: string;
  stopProcessing?: boolean;
  source?: string;
}
interface RuleEntity {
  id: string;
  title: string;
  attributes: RuleAttrs;
}
interface Named {
  id: string;
  title: string;
}
interface PreviewItem {
  transactionId: string;
  date: string;
  description: string;
  amount: number;
  changes: Record<string, string>;
  rules: string[];
}
interface Suggestion {
  transactionId: string;
  categoryId: string;
  categoryName: string;
  date: string;
  description: string;
  counterparty?: string;
  amount: number;
}

const FIELD_LABELS: Record<Field, string> = {
  description: 'Описание',
  counterparty: 'Контрагент',
  mcc: 'MCC-код',
  amount: 'Сумма (по модулю)',
  accountId: 'Счёт',
  bankCategory: 'Категория банка',
};
const OP_LABELS: Record<Op, string> = { contains: 'содержит', equals: 'равно', startsWith: 'начинается с', regex: 'рег. выражение', gt: 'больше', lt: 'меньше' };
const TEXT_OPS: Op[] = ['contains', 'equals', 'startsWith', 'regex'];
const NUM_OPS: Op[] = ['gt', 'lt', 'equals'];

const EMPTY: RuleAttrs = { name: '', isActive: true, priority: 100, matchMode: 'ALL', conditions: [{ field: 'description', op: 'contains', value: '' }], setScope: '' };

export default function FinanceRulesPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const [rules, setRules] = useState<RuleEntity[]>([]);
  const [categories, setCategories] = useState<Named[]>([]);
  const [accounts, setAccounts] = useState<Named[]>([]);
  const [editing, setEditing] = useState<{ id?: string; attrs: RuleAttrs } | null>(null);
  const [preview, setPreview] = useState<{ total: number; items: PreviewItem[]; title: string; ruleIds?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{ unavailable: boolean; model?: string; suggestions: Suggestion[]; note?: string } | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});

  const catName = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.title])), [categories]);

  const load = useCallback(async () => {
    const [r, c, a] = await Promise.all([
      apiFetch<RuleEntity[]>('/entities?entityType=finance_rule&status=ACTIVE'),
      apiFetch<Named[]>('/entities?entityType=financial_category&status=ACTIVE'),
      apiFetch<Named[]>('/entities?entityType=bank_account&status=ACTIVE'),
    ]);
    r.sort((x, y) => (x.attributes.priority ?? 100) - (y.attributes.priority ?? 100) || x.title.localeCompare(y.title));
    setRules(r);
    setCategories(c.sort((x, y) => x.title.localeCompare(y.title)));
    setAccounts(a);
  }, []);

  useEffect(() => {
    if (isAuthenticated) load().catch((e) => setError(e.message));
  }, [isAuthenticated, load]);

  function describeActions(a: RuleAttrs): string {
    const parts: string[] = [];
    if (a.setCategoryId) parts.push(`категория «${catName[a.setCategoryId] ?? '?'}»`);
    if (a.setScope) parts.push(a.setScope === 'FAMILY' ? 'семейный' : 'личный');
    if (a.setTransactionType) parts.push(a.setTransactionType === 'TRANSFER' ? 'перевод' : a.setTransactionType === 'INCOME' ? 'доход' : 'расход');
    if (a.setCounterparty) parts.push(`контрагент → «${a.setCounterparty}»`);
    return parts.join(', ') || '—';
  }

  function describeConditions(a: RuleAttrs): string {
    return (a.conditions ?? [])
      .map((c) => `${FIELD_LABELS[c.field]} ${OP_LABELS[c.op]} «${c.field === 'accountId' ? accounts.find((x) => x.id === c.value)?.title ?? c.value : c.value}»`)
      .join(a.matchMode === 'ANY' ? ' или ' : ' и ');
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      // Пустые строки, а не undefined — иначе при изменении снятое действие осталось бы (merge атрибутов).
      const attrs = { ...editing.attrs, setCategoryId: editing.attrs.setCategoryId ?? '', setScope: editing.attrs.setScope ?? '', setTransactionType: editing.attrs.setTransactionType ?? '', setCounterparty: editing.attrs.setCounterparty ?? '' };
      await apiFetch('/finance/rules', { method: 'POST', body: { id: editing.id, attributes: attrs } });
      toast.success('Правило сохранено');
      setEditing(null);
      await load();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { errors?: string[] }) : undefined;
      setError(body?.errors?.join('; ') ?? (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runPreview(opts: { draft?: RuleAttrs; ruleIds?: string[]; title: string }) {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch<{ total: number; items: PreviewItem[] }>('/finance/rules/apply', {
        method: 'POST',
        body: { dryRun: true, draftRule: opts.draft, ruleIds: opts.ruleIds },
      });
      setPreview({ ...res, title: opts.title, ruleIds: opts.ruleIds });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applyPreview() {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ total: number }>('/finance/rules/apply', { method: 'POST', body: { dryRun: false, ruleIds: preview.ruleIds } });
      toast.success(`Обновлено операций: ${res.total}`);
      setPreview(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function archiveRule(id: string) {
    try {
      await apiFetch(`/entities/${id}/archive`, { method: 'PATCH' });
      toast.success('Правило в архиве');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function askAi() {
    setAiLoading(true);
    setAiResult(null);
    try {
      const res = await apiFetch<{ unavailable: boolean; model?: string; suggestions: Suggestion[]; note?: string }>('/finance/ai/categorize/suggest', { method: 'POST', body: { limit: 30 } });
      setAiResult(res);
      setAccepted(Object.fromEntries(res.suggestions.map((s) => [s.transactionId, true])));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiLoading(false);
    }
  }

  async function applyAi() {
    if (!aiResult) return;
    const items = aiResult.suggestions.filter((s) => accepted[s.transactionId]).map((s) => ({ transactionId: s.transactionId, categoryId: s.categoryId }));
    if (!items.length) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ applied: number }>('/finance/ai/categorize/apply', { method: 'POST', body: { items } });
      toast.success(`Категории проставлены: ${res.applied}`);
      setAiResult({ ...aiResult, suggestions: aiResult.suggestions.filter((s) => !accepted[s.transactionId]) });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function ruleFromSuggestion(s: Suggestion) {
    const base = (s.counterparty || s.description || '').replace(/[0-9*#№]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3).slice(0, 2).join(' ');
    setEditing({
      attrs: {
        ...EMPTY,
        name: `${base || 'Правило'} → ${s.categoryName}`,
        conditions: [{ field: s.counterparty ? 'counterparty' : 'description', op: 'contains', value: base }],
        setCategoryId: s.categoryId,
        source: 'AI_SUGGESTION',
      },
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (loading || !isAuthenticated) return null;

  const setCond = (i: number, patch: Partial<Condition>) =>
    setEditing((e) => e && { ...e, attrs: { ...e.attrs, conditions: e.attrs.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) } });

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Правила автокатегоризации</h1>
          <p className="mt-1 text-sm text-ink/60">Срабатывают при импорте выписки. К старым операциям применяются только после предпросмотра.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => runPreview({ title: 'Все активные правила' })} disabled={busy || rules.length === 0}>
            <Eye size={16} /> Применить все к старым
          </Button>
          <Button onClick={() => setEditing({ attrs: { ...EMPTY } })}>
            <Plus size={16} /> Новое правило
          </Button>
        </div>
      </div>
      <div className="mt-4">
        <FinanceSubNav active="/finance/rules" />
      </div>
      <ErrorText>{error}</ErrorText>

      {editing && (
        <Card className="animate-in mt-4">
          <h2 className="font-display text-lg font-semibold">{editing.id ? 'Изменить правило' : 'Новое правило'}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_120px]">
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Название</span>
              <input className={inputClass} value={editing.attrs.name} onChange={(e) => setEditing({ ...editing, attrs: { ...editing.attrs, name: e.target.value } })} placeholder="Например: Продуктовые магазины" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Приоритет</span>
              <input type="number" className={inputClass} value={editing.attrs.priority ?? 100} onChange={(e) => setEditing({ ...editing, attrs: { ...editing.attrs, priority: Number(e.target.value) } })} />
            </label>
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Если</span>
              <select className="rounded-card border border-line bg-paper px-2 py-1 text-sm" value={editing.attrs.matchMode} onChange={(e) => setEditing({ ...editing, attrs: { ...editing.attrs, matchMode: e.target.value as 'ALL' | 'ANY' } })}>
                <option value="ALL">выполнены все условия</option>
                <option value="ANY">выполнено любое условие</option>
              </select>
            </div>
            <div className="mt-2 space-y-2">
              {editing.attrs.conditions.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr] gap-2 sm:grid-cols-[180px_150px_1fr_auto]">
                  <select
                    className="rounded-card border border-line bg-paper px-2 py-2 text-sm"
                    value={c.field}
                    onChange={(e) => {
                      const field = e.target.value as Field;
                      setCond(i, { field, op: field === 'amount' ? 'gt' : field === 'accountId' ? 'equals' : 'contains', value: '' });
                    }}
                  >
                    {(Object.keys(FIELD_LABELS) as Field[]).map((f) => (
                      <option key={f} value={f}>
                        {FIELD_LABELS[f]}
                      </option>
                    ))}
                  </select>
                  <select className="rounded-card border border-line bg-paper px-2 py-2 text-sm" value={c.op} disabled={c.field === 'accountId'} onChange={(e) => setCond(i, { op: e.target.value as Op })}>
                    {(c.field === 'amount' ? NUM_OPS : c.field === 'accountId' ? (['equals'] as Op[]) : TEXT_OPS).map((o) => (
                      <option key={o} value={o}>
                        {OP_LABELS[o]}
                      </option>
                    ))}
                  </select>
                  {c.field === 'accountId' ? (
                    <select className="col-span-2 rounded-card border border-line bg-paper px-2 py-2 text-sm sm:col-span-1" value={c.value} onChange={(e) => setCond(i, { value: e.target.value })}>
                      <option value="">— счёт —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className={`${inputClass} col-span-2 sm:col-span-1`} value={c.value} inputMode={c.field === 'amount' ? 'decimal' : undefined} onChange={(e) => setCond(i, { value: e.target.value })} placeholder={c.field === 'amount' ? '5000' : 'пятерочка'} />
                  )}
                  <button
                    className="col-span-2 justify-self-end rounded-card p-2 text-ink/40 hover:bg-paper-dim hover:text-clay sm:col-span-1"
                    title="Убрать условие"
                    onClick={() => setEditing({ ...editing, attrs: { ...editing.attrs, conditions: editing.attrs.conditions.filter((_, j) => j !== i) } })}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <Button variant="ghost" className="mt-1" onClick={() => setEditing({ ...editing, attrs: { ...editing.attrs, conditions: [...editing.attrs.conditions, { field: 'description', op: 'contains', value: '' }] } })}>
              <Plus size={14} /> Условие
            </Button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">То поставить категорию</span>
              <select className={inputClass} value={editing.attrs.setCategoryId ?? ''} onChange={(e) => setEditing({ ...editing, attrs: { ...editing.attrs, setCategoryId: e.target.value } })}>
                <option value="">— не менять —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Тип расхода</span>
              <select className={inputClass} value={editing.attrs.setScope ?? ''} onChange={(e) => setEditing({ ...editing, attrs: { ...editing.attrs, setScope: e.target.value } })}>
                <option value="">— не менять —</option>
                <option value="FAMILY">Семейный</option>
                <option value="PERSONAL">Личный</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Тип операции</span>
              <select className={inputClass} value={editing.attrs.setTransactionType ?? ''} onChange={(e) => setEditing({ ...editing, attrs: { ...editing.attrs, setTransactionType: e.target.value } })}>
                <option value="">— не менять —</option>
                <option value="TRANSFER">Перевод между своими счетами</option>
                <option value="EXPENSE">Расход</option>
                <option value="INCOME">Доход</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Переименовать контрагента</span>
              <input className={inputClass} value={editing.attrs.setCounterparty ?? ''} onChange={(e) => setEditing({ ...editing, attrs: { ...editing.attrs, setCounterparty: e.target.value } })} placeholder="Например: Пятёрочка" />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={editing.attrs.isActive !== false} onChange={(e) => setEditing({ ...editing, attrs: { ...editing.attrs, isActive: e.target.checked } })} /> Активно
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={editing.attrs.stopProcessing === true} onChange={(e) => setEditing({ ...editing, attrs: { ...editing.attrs, stopProcessing: e.target.checked } })} /> Не применять следующие правила
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={save} disabled={busy}>
              Сохранить
            </Button>
            <Button variant="secondary" onClick={() => runPreview({ draft: editing.attrs, title: `Черновик: ${editing.attrs.name || 'без названия'}` })} disabled={busy}>
              <Eye size={16} /> Что заденет
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}

      {preview && (
        <Card className="animate-in mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold">
              Предпросмотр · {preview.title}: {preview.total} операций
            </h2>
            <div className="flex gap-2">
              {!preview.title.startsWith('Черновик') && preview.total > 0 && (
                <Button onClick={applyPreview} disabled={busy}>
                  <Play size={16} /> Применить к {preview.total}
                </Button>
              )}
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Закрыть
              </Button>
            </div>
          </div>
          <p className="mt-1 text-xs text-ink/50">Заполняются только пустые поля — то, что вы проставили руками, не перезаписывается.{preview.title.startsWith('Черновик') && ' Сохраните правило, чтобы применить.'}</p>
          <div className="mt-2 max-h-80 divide-y divide-line overflow-y-auto text-sm">
            {preview.items.map((it) => (
              <div key={it.transactionId} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate">
                  {ruDate(it.date)} · {it.description} <span className="text-ink/40">{money(it.amount)}</span>
                </span>
                <span className="text-xs text-moss-600">
                  {it.changes.categoryId && `→ ${catName[it.changes.categoryId] ?? 'категория'} `}
                  {it.changes.scope && `· ${it.changes.scope === 'FAMILY' ? 'семейный' : 'личный'} `}
                  {it.changes.transactionType && `· ${it.changes.transactionType} `}
                  {it.changes.counterparty && `· «${it.changes.counterparty}»`}
                </span>
              </div>
            ))}
            {preview.items.length === 0 && <p className="py-2 text-ink/50">Ни одна операция не изменится.</p>}
          </div>
        </Card>
      )}

      <div className="mt-6 space-y-2">
        {rules.map((r) => (
          <Card key={r.id} className={r.attributes.isActive === false ? 'opacity-60' : ''}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <Wand2 size={14} className="text-ink/40" /> {r.title}
                  <span className="text-xs font-normal text-ink/40">#{r.attributes.priority ?? 100}</span>
                  {r.attributes.isActive === false && <Badge>выключено</Badge>}
                  {r.attributes.source === 'AI_SUGGESTION' && <Badge tone="gold">из подсказки ИИ</Badge>}
                </p>
                <p className="mt-1 text-sm text-ink/70">Если {describeConditions(r.attributes)}</p>
                <p className="text-sm text-moss-600">→ {describeActions(r.attributes)}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" title="Применить к старым операциям" onClick={() => runPreview({ ruleIds: [r.id], title: r.title })}>
                  <Eye size={16} />
                </Button>
                <Button variant="ghost" title="Изменить" onClick={() => setEditing({ id: r.id, attrs: { ...EMPTY, ...r.attributes, conditions: r.attributes.conditions ?? [] } })}>
                  <Pencil size={16} />
                </Button>
                <Button variant="ghost" title="В архив" onClick={() => archiveRule(r.id)}>
                  <Archive size={16} />
                </Button>
              </div>
            </div>
          </Card>
        ))}
        {rules.length === 0 && !editing && <p className="text-sm text-ink/50">Правил пока нет. Создайте первое или попросите ИИ подсказать категории ниже.</p>}
      </div>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <Sparkles size={16} className="text-gold" /> ИИ-подсказки категорий
            </h2>
            <p className="text-sm text-ink/60">Для последних операций без категории. Модель выбирает только из ваших категорий; применяется то, что вы отметили.</p>
          </div>
          <Button variant="secondary" onClick={askAi} disabled={aiLoading}>
            {aiLoading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Подсказать
          </Button>
        </div>
        {aiLoading && <p className="mt-2 text-xs text-ink/50">На ноутбуке без видеокарты это может занять пару минут.</p>}
        {aiResult?.unavailable && <p className="mt-2 text-sm text-clay">Ни одна модель не ответила — проверьте статус на странице «ИИ-отчёты».</p>}
        {aiResult?.note && <p className="mt-2 text-sm text-ink/60">{aiResult.note}</p>}
        {aiResult && !aiResult.unavailable && aiResult.suggestions.length === 0 && !aiResult.note && <p className="mt-2 text-sm text-ink/60">Подсказок нет: либо всё уже с категориями, либо модель не уверена.</p>}
        {aiResult && aiResult.suggestions.length > 0 && (
          <>
            <div className="mt-3 divide-y divide-line text-sm">
              {aiResult.suggestions.map((s) => (
                <div key={s.transactionId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <label className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" checked={accepted[s.transactionId] ?? false} onChange={(e) => setAccepted((a) => ({ ...a, [s.transactionId]: e.target.checked }))} />
                    <span className="truncate">
                      {ruDate(s.date)} · {s.description} <span className="text-ink/40">{money(s.amount)}</span>
                    </span>
                  </label>
                  <span className="flex items-center gap-2">
                    <Badge tone="moss">{s.categoryName}</Badge>
                    <button className="text-xs text-ink/50 underline hover:text-ink" onClick={() => ruleFromSuggestion(s)}>
                      сделать правило
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button onClick={applyAi} disabled={busy}>
                <Check size={16} /> Применить отмеченные
              </Button>
              {aiResult.model && <span className="text-xs text-ink/40">Модель: {aiResult.model}</span>}
            </div>
          </>
        )}
      </Card>
    </AppShell>
  );
}
