'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { FinanceSubNav } from '@/components/finance-subnav';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, Badge, ErrorText } from '@/components/ui';
import { money, monthBounds, ruDate, inputClass } from '@/lib/finance-format';
import { toast } from 'sonner';
import { Sparkles, RefreshCw, Download, Printer, Archive, Loader2, AlertTriangle, Send, Cpu, CheckCircle2, XCircle } from 'lucide-react';

interface EndpointStatus {
  role: 'primary' | 'fallback';
  url: string;
  provider: string;
  model: string;
  reachable: boolean;
  latencyMs: number | null;
  modelAvailable: boolean | null;
  error?: string;
}

interface ReportFacts {
  periodStart: string;
  periodEnd: string;
  currency: string;
  income: number;
  expense: number;
  net: number;
  savingsRatePercent: number | null;
  previous: { income: number; expense: number; net: number };
  expenseChangePercent: number | null;
  uncategorizedCount: number;
  uncategorizedExpense: number;
  familyExpense: number;
  personalExpense: number;
  categories: { category: string; expense: number; previousExpense: number; averageExpense: number; changePercent: number | null; share: number }[];
  anomalies: { category: string; expense: number; averageExpense: number; overPercent: number }[];
  topMerchants: { name: string; expense: number; count: number }[];
  largestExpenses: { date: string; description: string; amount: number; category: string }[];
}

interface ReportEntity {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  attributes: {
    periodStart: string;
    periodEnd: string;
    reportStatus: 'GENERATING' | 'READY' | 'FAILED';
    generator?: 'AI' | 'TEMPLATE';
    modelUsed?: string;
    narrative?: string;
    warnings?: string[];
    generationMs?: number;
    facts?: ReportFacts;
  };
}

const PRESETS = [
  { label: 'Этот месяц', range: () => monthBounds(0) },
  { label: 'Прошлый месяц', range: () => monthBounds(-1) },
  {
    label: '3 месяца',
    range: () => ({ start: monthBounds(-2).start, end: monthBounds(0).end }),
  },
];

function Delta({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <span className="text-ink/40">—</span>;
  return <span className={value > 0 ? 'text-clay' : 'text-moss-600'}>{value > 0 ? '+' : ''}{value}%</span>;
}

export default function FinanceReportsPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const [status, setStatus] = useState<{ configured: boolean; endpoints: EndpointStatus[] } | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [reports, setReports] = useState<ReportEntity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [period, setPeriod] = useState(monthBounds(-1));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ text: string | null; model?: string; unverified: string[]; unavailable: boolean } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      setStatus(await apiFetch('/finance/ai/status'));
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadReports = useCallback(async () => {
    const list = await apiFetch<ReportEntity[]>('/entities?entityType=finance_report&status=ACTIVE');
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    setReports(list);
    return list;
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadStatus();
    loadReports()
      .then((list) => setSelectedId((cur) => cur ?? list[0]?.id ?? null))
      .catch((e) => setError(e.message));
  }, [isAuthenticated, loadStatus, loadReports]);

  // Пока хоть один отчёт формируется — опрашиваем список раз в 4 секунды.
  useEffect(() => {
    const generating = reports.some((r) => r.attributes.reportStatus === 'GENERATING');
    if (generating && !pollRef.current) {
      pollRef.current = setInterval(() => {
        loadReports().catch(() => undefined);
      }, 4000);
    }
    if (!generating && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => undefined;
  }, [reports, loadReports]);
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  async function createReport(useAi: boolean) {
    setCreating(true);
    setError('');
    try {
      const r = await apiFetch<ReportEntity>('/finance/ai/reports', { method: 'POST', body: { periodStart: period.start, periodEnd: period.end, useAi } });
      await loadReports();
      setSelectedId(r.id);
      toast.success(useAi ? 'Цифры посчитаны, ИИ пишет выводы…' : 'Отчёт готов');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сформировать отчёт');
    } finally {
      setCreating(false);
    }
  }

  async function regenerate(id: string) {
    try {
      await apiFetch(`/finance/ai/reports/${id}/regenerate`, { method: 'POST' });
      await loadReports();
      toast.success('Пересчитываю по актуальным данным');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Ошибка');
    }
  }

  async function archive(id: string) {
    try {
      await apiFetch(`/entities/${id}/archive`, { method: 'PATCH' });
      const list = await loadReports();
      setSelectedId(list[0]?.id ?? null);
      toast.success('Отчёт перенесён в архив');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Ошибка');
    }
  }

  async function ask() {
    if (!question.trim()) return;
    setAsking(true);
    setAnswer(null);
    try {
      const res = await apiFetch<{ answer: string | null; model?: string; unverifiedNumbers: string[]; unavailable: boolean }>('/finance/ai/ask', {
        method: 'POST',
        body: { question, periodStart: period.start, periodEnd: period.end },
      });
      setAnswer({ text: res.answer, model: res.model, unverified: res.unverifiedNumbers ?? [], unavailable: res.unavailable });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'ИИ не ответил');
    } finally {
      setAsking(false);
    }
  }

  function downloadMarkdown(r: ReportEntity) {
    const f = r.attributes.facts;
    const parts = [`# ${r.title}`, '', r.attributes.modelUsed ? `_Текст: ${r.attributes.modelUsed}. Цифры рассчитаны Family OS._` : '_Цифры рассчитаны Family OS._', ''];
    if (r.attributes.warnings?.length) parts.push('> ' + r.attributes.warnings.join('\n> '), '');
    parts.push(r.attributes.narrative ?? '');
    if (f) {
      parts.push('', '## Категории', '', '| Категория | Расход | Прошлый период | Среднее | Доля |', '|---|---:|---:|---:|---:|');
      for (const c of f.categories) parts.push(`| ${c.category} | ${money(c.expense, f.currency)} | ${money(c.previousExpense, f.currency)} | ${money(c.averageExpense, f.currency)} | ${c.share}% |`);
    }
    const blob = new Blob([parts.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `family-os-report-${r.attributes.periodStart}_${r.attributes.periodEnd}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (loading || !isAuthenticated) return null;
  const selected = reports.find((r) => r.id === selectedId) ?? null;
  const facts = selected?.attributes.facts;
  const anyReachable = status?.endpoints.some((e) => e.reachable);

  return (
    <AppShell>
      <div className="print:hidden">
        <h1 className="font-display text-2xl font-semibold text-ink">ИИ-отчёты по финансам</h1>
        <p className="mt-1 text-sm text-ink/60">Все цифры считает Family OS, локальная модель только пишет выводы. Числа в тексте ИИ проверяются по расчётам.</p>
        <div className="mt-4">
          <FinanceSubNav active="/finance/reports" />
        </div>
      </div>

      {/* Статус моделей */}
      <Card className="mt-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-ink/50" />
            <h2 className="font-display text-base font-semibold">Модели</h2>
            {status && !status.configured && <Badge tone="clay">не настроены</Badge>}
            {status?.configured && <Badge tone={anyReachable ? 'moss' : 'clay'}>{anyReachable ? 'есть связь' : 'нет связи'}</Badge>}
          </div>
          <Button variant="ghost" onClick={loadStatus} disabled={statusLoading}>
            <RefreshCw size={14} className={statusLoading ? 'animate-spin' : ''} /> Проверить
          </Button>
        </div>
        {status?.configured === false && (
          <p className="mt-2 text-sm text-ink/60">Задайте LLM_URL (и при желании LLM_FALLBACK_*) в .env — см. docs/ITERATION_4_FINANCE_AI.md. Без ИИ отчёты формируются по шаблону.</p>
        )}
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {status?.endpoints.map((ep) => (
            <div key={ep.role} className="flex min-w-0 items-start gap-2 overflow-hidden rounded-card border border-line p-2 text-sm">
              {ep.reachable ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-moss-600" /> : <XCircle size={16} className="mt-0.5 shrink-0 text-clay" />}
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {ep.role === 'primary' ? 'Основная' : 'Резервная'} · {ep.model}
                </p>
                <p className="truncate text-xs text-ink/50">
                  {ep.provider === 'ollama' ? 'Ollama' : 'OpenAI-совместимый (LM Studio)'} · {ep.url}
                </p>
                <p className="text-xs text-ink/50">
                  {ep.reachable ? `отвечает за ${ep.latencyMs} мс` : `недоступна${ep.error ? `: ${ep.error}` : ''}`}
                  {ep.reachable && ep.modelAvailable === false && ' · модель не найдена на сервере'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Период + действия */}
      <Card className="mt-4 print:hidden">
        <div className="flex flex-wrap items-end gap-2">
          {PRESETS.map((p) => (
            <Button key={p.label} variant="secondary" onClick={() => setPeriod(p.range())}>
              {p.label}
            </Button>
          ))}
          <label className="text-sm">
            <span className="block text-xs text-ink/50">с</span>
            <input type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-ink/50">по</span>
            <input type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} className={inputClass} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => createReport(true)} disabled={creating}>
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Сформировать с ИИ
          </Button>
          <Button variant="secondary" onClick={() => createReport(false)} disabled={creating}>
            Без ИИ (шаблон)
          </Button>
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <p className="text-sm font-medium">Спросить ИИ про финансы за этот период</p>
          <div className="mt-2 flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ask()}
              placeholder="Например: на чём мы можем сэкономить в этом месяце?"
              className={inputClass}
            />
            <Button onClick={ask} disabled={asking || !question.trim()}>
              {asking ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </Button>
          </div>
          {asking && <p className="mt-2 text-xs text-ink/50">Модель думает. На ноутбуке без видеокарты это может занять 1–3 минуты.</p>}
          {answer && (
            <div className="mt-3 rounded-card bg-paper-dim p-3 text-sm">
              {answer.unavailable ? (
                <p className="text-clay">Ни одна модель сейчас не отвечает — проверьте статус выше.</p>
              ) : (
                <>
                  <div className="markdown-body text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer.text ?? ''}</ReactMarkdown>
                  </div>
                  {answer.unverified.length > 0 && (
                    <p className="mt-2 flex items-start gap-1 text-xs text-clay">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Числа не найдены в расчётах: {answer.unverified.join(', ')}
                    </p>
                  )}
                  {answer.model && <p className="mt-2 text-xs text-ink/40">Ответила: {answer.model}</p>}
                </>
              )}
            </div>
          )}
        </div>
      </Card>

      <ErrorText>{error}</ErrorText>

      <div className="mt-6 grid gap-4 lg:grid-cols-[220px_1fr]">
        {/* История */}
        <div className="print:hidden">
          <h2 className="mb-2 font-display text-base font-semibold">История</h2>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {reports.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`shrink-0 rounded-card border px-3 py-2 text-left text-sm transition-colors ${r.id === selectedId ? 'border-moss-500 bg-moss-500/10' : 'border-line hover:bg-paper-dim'}`}
              >
                <p className="font-medium">
                  {ruDate(r.attributes.periodStart)} — {ruDate(r.attributes.periodEnd)}
                </p>
                <p className="text-xs text-ink/50">
                  {r.attributes.reportStatus === 'GENERATING' ? 'формируется…' : r.attributes.generator === 'AI' ? 'ИИ' : 'шаблон'}
                </p>
              </button>
            ))}
            {reports.length === 0 && <p className="text-sm text-ink/50">Отчётов пока нет.</p>}
          </div>
        </div>

        {/* Отчёт */}
        <div className="min-w-0">
          {selected && (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg font-semibold">
                    Отчёт за {ruDate(selected.attributes.periodStart)} — {ruDate(selected.attributes.periodEnd)}
                  </h2>
                  <p className="text-xs text-ink/50">
                    {selected.attributes.generator === 'AI' && selected.attributes.modelUsed
                      ? `Текст: ${selected.attributes.modelUsed}${selected.attributes.generationMs ? `, ${Math.round(selected.attributes.generationMs / 1000)} с` : ''}`
                      : selected.attributes.reportStatus === 'GENERATING'
                        ? 'ИИ пишет текст…'
                        : 'Текст по шаблону'}
                    {' · '}цифры рассчитаны Family OS
                  </p>
                </div>
                <div className="flex gap-1 print:hidden">
                  <Button variant="ghost" title="Пересчитать" onClick={() => regenerate(selected.id)} disabled={selected.attributes.reportStatus === 'GENERATING'}>
                    <RefreshCw size={16} />
                  </Button>
                  <Button variant="ghost" title="Скачать Markdown" onClick={() => downloadMarkdown(selected)}>
                    <Download size={16} />
                  </Button>
                  <Button variant="ghost" title="Печать / PDF" onClick={() => window.print()}>
                    <Printer size={16} />
                  </Button>
                  <Button variant="ghost" title="В архив" onClick={() => archive(selected.id)}>
                    <Archive size={16} />
                  </Button>
                </div>
              </div>

              {selected.attributes.warnings?.map((w) => (
                <p key={w} className="mt-2 flex items-start gap-1 rounded-card bg-gold/10 p-2 text-xs text-ink/80">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-gold" /> {w}
                </p>
              ))}

              {facts && (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-card bg-paper-dim p-3">
                    <p className="text-xs text-ink/50">Доходы</p>
                    <p className="font-display text-lg font-semibold text-moss-600">{money(facts.income, facts.currency)}</p>
                  </div>
                  <div className="rounded-card bg-paper-dim p-3">
                    <p className="text-xs text-ink/50">Расходы</p>
                    <p className="font-display text-lg font-semibold text-clay">{money(facts.expense, facts.currency)}</p>
                    <p className="text-xs">
                      <Delta value={facts.expenseChangePercent} /> к прошлому
                    </p>
                  </div>
                  <div className="rounded-card bg-paper-dim p-3">
                    <p className="text-xs text-ink/50">Итог</p>
                    <p className={`font-display text-lg font-semibold ${facts.net >= 0 ? 'text-moss-600' : 'text-clay'}`}>{money(facts.net, facts.currency)}</p>
                  </div>
                  <div className="rounded-card bg-paper-dim p-3">
                    <p className="text-xs text-ink/50">Норма сбережений</p>
                    <p className="font-display text-lg font-semibold">{facts.savingsRatePercent === null ? '—' : `${facts.savingsRatePercent}%`}</p>
                  </div>
                </div>
              )}

              <div className="markdown-body mt-4 text-sm">
                {selected.attributes.reportStatus === 'GENERATING' ? (
                  <p className="flex items-center gap-2 text-sm text-ink/60">
                    <Loader2 size={16} className="animate-spin" /> Модель пишет выводы. Страницу можно закрыть — отчёт сохранится.
                  </p>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.attributes.narrative ?? ''}</ReactMarkdown>
                )}
              </div>

              {facts && facts.categories.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <h3 className="font-display text-base font-semibold">Категории (расчёт)</h3>
                  <table className="mt-2 w-full min-w-[480px] text-sm">
                    <thead className="text-left text-xs text-ink/50">
                      <tr>
                        <th className="py-1 font-normal">Категория</th>
                        <th className="py-1 text-right font-normal">Расход</th>
                        <th className="py-1 text-right font-normal">Прошлый</th>
                        <th className="py-1 text-right font-normal">Среднее за 3</th>
                        <th className="py-1 text-right font-normal">Доля</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {facts.categories.map((c) => (
                        <tr key={c.category}>
                          <td className="py-1.5">{c.category}</td>
                          <td className="py-1.5 text-right">{money(c.expense, facts.currency)}</td>
                          <td className="py-1.5 text-right text-ink/60">{money(c.previousExpense, facts.currency)}</td>
                          <td className="py-1.5 text-right text-ink/60">{money(c.averageExpense, facts.currency)}</td>
                          <td className="py-1.5 text-right text-ink/60">{c.share}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {facts && facts.largestExpenses.length > 0 && (
                <div className="mt-4">
                  <h3 className="font-display text-base font-semibold">Крупнейшие траты</h3>
                  <div className="mt-1 divide-y divide-line text-sm">
                    {facts.largestExpenses.map((t, i) => (
                      <div key={i} className="flex justify-between gap-2 py-1.5">
                        <span className="min-w-0 truncate">
                          {ruDate(t.date)} · {t.description} <span className="text-ink/40">({t.category})</span>
                        </span>
                        <span className="shrink-0 text-clay">{money(t.amount, facts.currency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
