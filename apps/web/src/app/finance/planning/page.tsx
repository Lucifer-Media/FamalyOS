'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { FinanceSubNav } from '@/components/finance-subnav';
import { usePeople } from '@/components/ui/person-select';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, Badge, ErrorText } from '@/components/ui';
import { money, ruDate, inputClass, monthLabel } from '@/lib/finance-format';
import { toast } from 'sonner';
import { Plus, Sparkles, Loader2, AlertTriangle, CheckCircle2, Clock, Lightbulb, Stethoscope, Send, CalendarRange } from 'lucide-react';

type PlanKind = 'TARGET' | 'RECURRING' | 'OPEN';
interface PlanAllocation {
  planId: string;
  name: string;
  kind: PlanKind;
  scope: 'PERSONAL' | 'FAMILY';
  ownerName?: string;
  priority: number;
  requiredMonthly: number;
  allocatedMonthly: number;
  fits: boolean;
  remaining: number;
  savedAmount: number;
  targetAmount: number;
  dueDate: string | null;
  projectedDate: string | null;
  overdue: boolean;
  categoryName?: string;
  categoryAverageMonthly?: number;
}
interface CategoryForecast {
  categoryId: string;
  categoryName: string;
  averageMonthly: number;
  lastMonth: number;
  trendPercent: number | null;
  forecastNextMonth: number;
  yearlyEstimate: number;
  hasPlan: boolean;
}
interface PlanningResult {
  historyMonths: number;
  sufficientHistory: boolean;
  monthlyCapacity: number;
  capacitySource: 'MEDIAN' | 'OVERRIDE';
  medianIncome: number;
  medianExpense: number;
  totalRequired: number;
  totalAllocated: number;
  freeAfterPlans: number;
  fits: boolean;
  plans: PlanAllocation[];
  categories: CategoryForecast[];
  timeline: { month: string; planId: string; name: string; amount: number; projectedSaved: number; covered: boolean }[];
  suggestions: { kind: string; text: string; categoryId?: string; amount?: number }[];
}
interface Named {
  id: string;
  title: string;
}

const KIND_LABEL: Record<PlanKind, string> = { TARGET: 'к дате', RECURRING: 'резерв', OPEN: 'в месяц' };
const EMPTY_FORM = {
  name: '',
  planKind: 'TARGET' as PlanKind,
  scope: 'FAMILY' as 'FAMILY' | 'PERSONAL',
  ownerPersonId: '',
  targetAmount: '',
  deadline: '',
  nextDate: '',
  recurrenceMonths: '6',
  plannedMonthly: '',
  priority: '3',
  categoryId: '',
  icon: '',
  startAmount: '',
};
const num = (s: string) => (s ? Number(s.replace(/\s/g, '').replace(',', '.')) : undefined);

export default function PlanningPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const people = usePeople();
  const [categories, setCategories] = useState<Named[]>([]);
  const [filter, setFilter] = useState<{ scope: string; ownerPersonId: string }>({ scope: '', ownerPersonId: '' });
  const [capacity, setCapacity] = useState('');
  const [plan, setPlan] = useState<PlanningResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [ai, setAi] = useState<{ loading: boolean; answer?: string | null; unverified?: string[]; unavailable?: boolean; model?: string }>({ loading: false });
  const [question, setQuestion] = useState('');

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (filter.scope) q.set('scope', filter.scope);
    if (filter.ownerPersonId) q.set('ownerPersonId', filter.ownerPersonId);
    if (capacity) q.set('capacity', String(num(capacity) ?? ''));
    setPlan(await apiFetch<PlanningResult>(`/finance/planning?${q.toString()}`));
  }, [filter, capacity]);

  useEffect(() => {
    if (!isAuthenticated) return;
    load().catch((e) => setError(e.message));
  }, [isAuthenticated, load]);
  useEffect(() => {
    if (isAuthenticated) apiFetch<Named[]>('/entities?entityType=financial_category&status=ACTIVE').then((c) => setCategories(c.sort((a, b) => a.title.localeCompare(b.title)))).catch(() => undefined);
  }, [isAuthenticated]);

  async function createPlan(override?: Partial<typeof EMPTY_FORM>) {
    const f = { ...form, ...override };
    setError('');
    try {
      await apiFetch('/finance/planning/plans', {
        method: 'POST',
        body: {
          name: f.name,
          planKind: f.planKind,
          scope: f.scope,
          ownerPersonId: f.scope === 'PERSONAL' ? f.ownerPersonId : undefined,
          targetAmount: num(f.targetAmount),
          deadline: f.deadline || undefined,
          nextDate: f.nextDate || undefined,
          recurrenceMonths: num(f.recurrenceMonths),
          plannedMonthly: num(f.plannedMonthly),
          priority: num(f.priority),
          categoryId: f.categoryId || undefined,
          icon: f.icon || undefined,
          startAmount: num(f.startAmount),
        },
      });
      toast.success('План добавлен');
      setCreating(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось создать план');
    }
  }

  function reserveForCategory(c: CategoryForecast) {
    setForm({ ...EMPTY_FORM, name: `Резерв: ${c.categoryName}`, planKind: 'OPEN', plannedMonthly: String(Math.round(c.forecastNextMonth)), categoryId: c.categoryId, priority: '1' });
    setCreating(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function askAi(withQuestion: boolean) {
    setAi({ loading: true });
    try {
      const res = await apiFetch<{ answer: string | null; unavailable: boolean; unverifiedNumbers: string[]; model?: string }>('/finance/planning/explain', {
        method: 'POST',
        body: { scope: filter.scope || undefined, ownerPersonId: filter.ownerPersonId || undefined, capacity: capacity ? num(capacity) : null, question: withQuestion ? question : undefined },
      });
      setAi({ loading: false, answer: res.answer, unavailable: res.unavailable, unverified: res.unverifiedNumbers, model: res.model });
    } catch (e) {
      setAi({ loading: false });
      toast.error((e as Error).message);
    }
  }

  if (loading || !isAuthenticated) return null;
  const set = (patch: Partial<typeof EMPTY_FORM>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Финансовый план</h1>
          <p className="mt-1 text-sm text-ink/60">Сколько откладывать на врачей, отпуск и другие планы — с учётом того, сколько реально остаётся в месяц.</p>
        </div>
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus size={16} /> Новый план
        </Button>
      </div>
      <div className="mt-4">
        <FinanceSubNav active="/finance/planning" />
      </div>
      <ErrorText>{error}</ErrorText>

      {creating && (
        <Card className="animate-in mt-4">
          <div className="flex flex-wrap gap-2">
            {(['TARGET', 'RECURRING', 'OPEN'] as PlanKind[]).map((k) => (
              <button key={k} onClick={() => set({ planKind: k })} className={`rounded-card px-3 py-1.5 text-sm ${form.planKind === k ? 'bg-moss-500 text-white' : 'bg-paper-dim text-ink/70'}`}>
                {k === 'TARGET' ? 'Накопить к дате' : k === 'RECURRING' ? 'Регулярная трата (резерв)' : 'Ежемесячный резерв'}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink/50">
            {form.planKind === 'TARGET' && 'Например: отпуск 180 000 ₽ к 20.12, операция у стоматолога к весне.'}
            {form.planKind === 'RECURRING' && 'Например: стоматолог 20 000 ₽ раз в 6 месяцев, страховка раз в год — система посчитает, сколько откладывать каждый месяц.'}
            {form.planKind === 'OPEN' && 'Например: врачи и лекарства ≈ 6 000 ₽ в месяц. Свяжите с категорией — будет видно, хватает ли резерва по факту.'}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-ink/70">Название</span>
              <input className={inputClass} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Отпуск в Ереване" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Чей план</span>
              <select className={inputClass} value={form.scope} onChange={(e) => set({ scope: e.target.value as 'FAMILY' | 'PERSONAL' })}>
                <option value="FAMILY">Общий</option>
                <option value="PERSONAL">Личный</option>
              </select>
            </label>
            {form.scope === 'PERSONAL' ? (
              <label className="text-sm">
                <span className="mb-1 block text-ink/70">Чей</span>
                <select className={inputClass} value={form.ownerPersonId} onChange={(e) => set({ ownerPersonId: e.target.value })}>
                  <option value="">— выберите —</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="hidden sm:block" />
            )}
            {form.planKind !== 'OPEN' && (
              <label className="text-sm">
                <span className="mb-1 block text-ink/70">{form.planKind === 'RECURRING' ? 'Сумма одной траты, ₽' : 'Сколько нужно, ₽'}</span>
                <input className={inputClass} inputMode="decimal" value={form.targetAmount} onChange={(e) => set({ targetAmount: e.target.value })} />
              </label>
            )}
            {form.planKind === 'TARGET' && (
              <label className="text-sm">
                <span className="mb-1 block text-ink/70">К какой дате</span>
                <input type="date" className={inputClass} value={form.deadline} onChange={(e) => set({ deadline: e.target.value })} />
              </label>
            )}
            {form.planKind === 'RECURRING' && (
              <>
                <label className="text-sm">
                  <span className="mb-1 block text-ink/70">Каждые N месяцев</span>
                  <input className={inputClass} inputMode="numeric" value={form.recurrenceMonths} onChange={(e) => set({ recurrenceMonths: e.target.value })} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-ink/70">Ближайший раз</span>
                  <input type="date" className={inputClass} value={form.nextDate} onChange={(e) => set({ nextDate: e.target.value })} />
                </label>
              </>
            )}
            {form.planKind === 'OPEN' && (
              <label className="text-sm">
                <span className="mb-1 block text-ink/70">Откладывать в месяц, ₽</span>
                <input className={inputClass} inputMode="decimal" value={form.plannedMonthly} onChange={(e) => set({ plannedMonthly: e.target.value })} />
              </label>
            )}
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Приоритет (1 — самое важное)</span>
              <select className={inputClass} value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
                {[1, 2, 3, 4, 5].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Категория трат (для сверки с фактом)</span>
              <select className={inputClass} value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                <option value="">— нет —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            {form.planKind !== 'OPEN' && (
              <label className="text-sm">
                <span className="mb-1 block text-ink/70">Уже отложено, ₽</span>
                <input className={inputClass} inputMode="decimal" value={form.startAmount} onChange={(e) => set({ startAmount: e.target.value })} placeholder="0" />
              </label>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => createPlan()}>Добавить</Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}

      {/* Фильтр и what-if */}
      <Card className="mt-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-ink/50">Планы</span>
            <select
              className={inputClass}
              value={filter.ownerPersonId ? `p:${filter.ownerPersonId}` : filter.scope}
              onChange={(e) => {
                const v = e.target.value;
                setFilter(v.startsWith('p:') ? { scope: 'PERSONAL', ownerPersonId: v.slice(2) } : { scope: v, ownerPersonId: '' });
              }}
            >
              <option value="">Все</option>
              <option value="FAMILY">Общие</option>
              <option value="PERSONAL">Личные (все)</option>
              {people.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  Личные: {p.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-ink/50">А если свободно в месяц будет, ₽</span>
            <input className={`${inputClass} w-44`} inputMode="decimal" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder={plan ? String(Math.round(plan.monthlyCapacity)) : ''} />
          </label>
          {capacity && (
            <Button variant="ghost" onClick={() => setCapacity('')}>
              сбросить
            </Button>
          )}
        </div>

        {plan && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-card bg-paper-dim p-3">
              <p className="text-xs text-ink/50">Свободно в месяц</p>
              <p className="font-display text-lg font-semibold">{money(plan.monthlyCapacity)}</p>
              <p className="text-xs text-ink/50">{plan.capacitySource === 'OVERRIDE' ? 'задано вручную' : `медиана за ${plan.historyMonths} мес.`}</p>
            </div>
            <div className="rounded-card bg-paper-dim p-3">
              <p className="text-xs text-ink/50">Нужно на планы</p>
              <p className={`font-display text-lg font-semibold ${plan.fits ? '' : 'text-clay'}`}>{money(plan.totalRequired)}</p>
            </div>
            <div className="rounded-card bg-paper-dim p-3">
              <p className="text-xs text-ink/50">Остаётся после планов</p>
              <p className={`font-display text-lg font-semibold ${plan.freeAfterPlans > 0 ? 'text-moss-600' : ''}`}>{money(plan.freeAfterPlans)}</p>
            </div>
            <div className="rounded-card bg-paper-dim p-3">
              <p className="text-xs text-ink/50">Доходы / расходы (медиана)</p>
              <p className="text-sm font-medium">
                {money(plan.medianIncome)} / {money(plan.medianExpense)}
              </p>
            </div>
          </div>
        )}

        {plan && plan.suggestions.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {plan.suggestions.map((s, i) => (
              <p key={i} className={`flex items-start gap-2 rounded-card p-2 text-sm ${s.kind === 'FREE_MONEY' ? 'bg-moss-500/10' : s.kind.startsWith('CATEGORY') ? 'bg-gold/10' : 'bg-clay/10'}`}>
                {s.kind === 'FREE_MONEY' ? <Lightbulb size={16} className="mt-0.5 shrink-0 text-moss-600" /> : s.kind.startsWith('CATEGORY') ? <Stethoscope size={16} className="mt-0.5 shrink-0 text-gold" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-clay" />}
                <span>{s.text}</span>
              </p>
            ))}
          </div>
        )}

        <div className="mt-4 border-t border-line pt-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => askAi(false)} disabled={ai.loading}>
              {ai.loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Разобрать план с ИИ
            </Button>
            <div className="flex min-w-0 flex-1 gap-2">
              <input className={inputClass} value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && question.trim() && askAi(true)} placeholder="Успеем ли и в Ереван, и к стоматологу?" />
              <Button onClick={() => askAi(true)} disabled={ai.loading || !question.trim()} aria-label="Спросить">
                <Send size={16} />
              </Button>
            </div>
          </div>
          {ai.loading && <p className="mt-2 text-xs text-ink/50">Модель думает — на ноутбуке это до пары минут.</p>}
          {ai.unavailable && <p className="mt-2 text-sm text-clay">ИИ сейчас не отвечает — подсказки выше посчитаны без него.</p>}
          {ai.answer && (
            <div className="mt-3 rounded-card bg-paper-dim p-3">
              <div className="markdown-body text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{ai.answer}</ReactMarkdown>
              </div>
              {!!ai.unverified?.length && (
                <p className="mt-2 flex items-start gap-1 text-xs text-clay">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Числа не найдены в расчёте: {ai.unverified.join(', ')}
                </p>
              )}
              {ai.model && <p className="mt-1 text-xs text-ink/40">Модель: {ai.model}</p>}
            </div>
          )}
        </div>
      </Card>

      {/* Планы */}
      <h2 className="mt-6 font-display text-lg font-semibold">Планы по очереди финансирования</h2>
      <p className="text-xs text-ink/50">Сначала приоритет, при равном — ближайший срок. Пополнения — на странице «Копилки».</p>
      <div className="mt-2 space-y-2">
        {plan?.plans.map((p) => {
          const pct = p.kind === 'OPEN' ? null : p.targetAmount > 0 ? Math.min(100, (p.savedAmount / p.targetAmount) * 100) : 0;
          return (
            <Card key={p.planId} className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 font-medium">
                    {p.fits ? <CheckCircle2 size={16} className="text-moss-600" /> : <Clock size={16} className="text-clay" />}
                    <Link href={`/documents/financial_goal/${p.planId}`} className="hover:underline">
                      {p.name}
                    </Link>
                    <Badge>{p.scope === 'FAMILY' ? 'общий' : p.ownerName ?? 'личный'}</Badge>
                    <Badge tone="moss">{KIND_LABEL[p.kind]}</Badge>
                    <span className="text-xs font-normal text-ink/40">приоритет {p.priority}</span>
                  </p>
                  <p className="mt-1 text-sm text-ink/70">
                    Нужно {money(p.requiredMonthly)}/мес · помещается <span className={p.fits ? 'text-moss-600' : 'text-clay'}>{money(p.allocatedMonthly)}</span>
                    {p.dueDate && ` · срок ${ruDate(p.dueDate)}`}
                    {!p.fits && p.projectedDate && p.kind !== 'OPEN' && <span className="text-clay"> → успеем к {ruDate(p.projectedDate)}</span>}
                  </p>
                  {p.categoryName && p.categoryAverageMonthly !== undefined && (
                    <p className="text-xs text-ink/50">
                      Факт по «{p.categoryName}»: {money(p.categoryAverageMonthly)}/мес в среднем
                    </p>
                  )}
                </div>
                {pct !== null && (
                  <div className="w-full sm:w-48">
                    <p className="text-right text-xs text-ink/60">
                      {money(p.savedAmount)} из {money(p.targetAmount)}
                    </p>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper-dim">
                      <div className="h-full bg-moss-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
        {plan && plan.plans.length === 0 && <p className="text-sm text-ink/50">Планов пока нет. Добавьте первый — например, резерв на врачей.</p>}
      </div>

      {plan && plan.timeline.length > 0 && (
        <Card className="mt-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <CalendarRange size={16} className="text-ink/50" /> Ближайшие 12 месяцев
          </h2>
          <div className="mt-2 divide-y divide-line text-sm">
            {plan.timeline.map((t, i) => (
              <div key={i} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>
                  <span className="capitalize text-ink/60">{monthLabel(t.month)}</span> · {t.name}
                </span>
                <span className={t.covered ? 'text-moss-600' : 'text-clay'}>
                  {money(t.amount)} {t.covered ? '— хватит' : `— будет ≈ ${money(t.projectedSaved)}`}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {plan && plan.categories.length > 0 && (
        <Card className="mt-6">
          <h2 className="font-display text-lg font-semibold">Прогноз трат по категориям</h2>
          <p className="text-xs text-ink/50">Среднее за {plan.historyMonths} мес. и прогноз на следующий месяц (60% — последние 3 месяца, 40% — вся история).</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs text-ink/50">
                <tr>
                  <th className="py-1 font-normal">Категория</th>
                  <th className="py-1 text-right font-normal">Среднее/мес</th>
                  <th className="py-1 text-right font-normal">Тренд</th>
                  <th className="py-1 text-right font-normal">Прогноз</th>
                  <th className="py-1 text-right font-normal">≈ в год</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {plan.categories.slice(0, 15).map((c) => (
                  <tr key={c.categoryId}>
                    <td className="py-1.5">{c.categoryName}</td>
                    <td className="py-1.5 text-right">{money(c.averageMonthly)}</td>
                    <td className={`py-1.5 text-right ${c.trendPercent !== null && c.trendPercent > 10 ? 'text-clay' : 'text-ink/60'}`}>{c.trendPercent === null ? '—' : `${c.trendPercent > 0 ? '+' : ''}${c.trendPercent}%`}</td>
                    <td className="py-1.5 text-right">{money(c.forecastNextMonth)}</td>
                    <td className="py-1.5 text-right text-ink/60">{money(c.yearlyEstimate)}</td>
                    <td className="py-1.5 text-right">
                      {c.hasPlan ? (
                        <Badge tone="moss">есть резерв</Badge>
                      ) : (
                        <button className="text-xs text-moss-600 underline" onClick={() => reserveForCategory(c)}>
                          завести резерв
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </AppShell>
  );
}
