'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { FinanceSubNav } from '@/components/finance-subnav';
import { apiFetch } from '@/lib/api';
import { Button, Card, Badge, ErrorText } from '@/components/ui';
import { inputClass } from '@/lib/finance-format';
import { toast } from 'sonner';
import { Send, KeyRound, Unlink, BellRing, CheckCircle2, XCircle, Copy } from 'lucide-react';

interface LinkRow {
  id: string;
  telegramUsername?: string;
  telegramUserId: string;
  chatId: string;
  defaultAccountId?: string;
  defaultScope?: string;
  notifyBudgets?: boolean;
}
interface Status {
  configured: boolean;
  running: boolean;
  botUsername: string | null;
  allowedChats: string[];
  lastPollAt: string | null;
  lastError: string | null;
  links: LinkRow[];
}
interface Named {
  id: string;
  title: string;
}

export default function TelegramPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [accounts, setAccounts] = useState<Named[]>([]);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [s, a] = await Promise.all([apiFetch<Status>('/telegram/status'), apiFetch<Named[]>('/entities?entityType=bank_account&status=ACTIVE')]);
    setStatus(s);
    setAccounts(a);
  }, []);

  useEffect(() => {
    if (isAuthenticated) load().catch((e) => setError(e.message));
  }, [isAuthenticated, load]);

  async function getCode() {
    try {
      setCode(await apiFetch('/telegram/link-code', { method: 'POST' }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function updateLink(id: string, attributes: Record<string, unknown>) {
    try {
      await apiFetch(`/entities/${id}`, { method: 'PATCH', body: { attributes, changeSummary: 'Настройки Telegram' } });
      toast.success('Сохранено');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function unlink(id: string) {
    try {
      await apiFetch(`/entities/${id}/archive`, { method: 'PATCH', body: { changeSummary: 'Отвязка Telegram' } });
      toast.success('Telegram отвязан');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function checkBudgets() {
    try {
      const r = await apiFetch<{ checked: boolean; reason?: string }>('/telegram/check-budgets', { method: 'POST' });
      toast.success(r.checked ? 'Проверено — если бюджет у порога, уведомление уже в чате' : r.reason ?? 'Не проверено');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold text-ink">Telegram-бот</h1>
      <p className="mt-1 text-sm text-ink/60">Быстрая запись трат, отчёты, планы и уведомления о бюджетах в вашем семейном чате.</p>
      <div className="mt-4">
        <FinanceSubNav active="/finance/telegram" />
      </div>
      <ErrorText>{error}</ErrorText>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          {status?.running ? <CheckCircle2 size={16} className="text-moss-600" /> : <XCircle size={16} className="text-clay" />}
          <p className="font-medium">
            {!status ? 'Загрузка…' : !status.configured ? 'Бот не настроен на сервере' : status.running ? `Бот работает${status.botUsername ? ` — @${status.botUsername}` : ''}` : 'Бот настроен, но не запущен'}
          </p>
          {status && status.allowedChats.length > 0 && <Badge tone="moss">чатов в белом списке: {status.allowedChats.length}</Badge>}
        </div>
        {status?.lastError && <p className="mt-1 text-xs text-clay">Последняя ошибка связи с Telegram: {status.lastError}</p>}
        {status && !status.configured && (
          <p className="mt-2 text-sm text-ink/60">
            Добавьте в .env на сервере <code>TELEGRAM_BOT_TOKEN</code> и <code>TELEGRAM_ALLOWED_CHAT_IDS</code>, затем пересоздайте контейнер api. Подробно — docs/ITERATION_4_1_PLANNING_TELEGRAM.md.
          </p>
        )}
      </Card>

      <Card className="mt-4">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <KeyRound size={16} className="text-ink/50" /> Привязать мой Telegram
        </h2>
        <p className="mt-1 text-sm text-ink/60">Каждый член семьи привязывает свой Telegram к своей учётной записи — записи из бота сохраняются от вашего имени, с вашими правами.</p>
        {code ? (
          <div className="animate-in mt-3 rounded-card bg-paper-dim p-3">
            <p className="text-sm">Отправьте в чат с ботом (код действует 10 минут, одноразовый):</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="rounded-card bg-paper px-3 py-2 font-mono text-lg">/link {code.code}</code>
              <Button
                variant="ghost"
                onClick={() => {
                  navigator.clipboard?.writeText(`/link ${code.code}`).then(() => toast.success('Скопировано'), () => undefined);
                }}
                aria-label="Копировать"
              >
                <Copy size={16} />
              </Button>
            </div>
          </div>
        ) : (
          <Button className="mt-3" onClick={getCode} disabled={!status?.configured}>
            <Send size={16} /> Получить код
          </Button>
        )}
      </Card>

      {status && status.links.length > 0 && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold">Мои привязки</h2>
            <Button variant="secondary" onClick={checkBudgets}>
              <BellRing size={16} /> Проверить бюджеты сейчас
            </Button>
          </div>
          <div className="mt-2 divide-y divide-line">
            {status.links.map((l) => (
              <div key={l.id} className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_200px_160px_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="font-medium">{l.telegramUsername ? `@${l.telegramUsername}` : `ID ${l.telegramUserId}`}</p>
                  <p className="text-xs text-ink/50">чат {l.chatId}</p>
                </div>
                <select className={inputClass} value={l.defaultAccountId ?? ''} onChange={(e) => updateLink(l.id, { defaultAccountId: e.target.value })}>
                  <option value="">— счёт по умолчанию —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
                </select>
                <select className={inputClass} value={l.defaultScope ?? ''} onChange={(e) => updateLink(l.id, { defaultScope: e.target.value })}>
                  <option value="">семейный (по умолч.)</option>
                  <option value="FAMILY">семейный</option>
                  <option value="PERSONAL">личный</option>
                </select>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={l.notifyBudgets !== false} onChange={(e) => updateLink(l.id, { notifyBudgets: e.target.checked })} /> бюджеты
                  </label>
                  <Button variant="ghost" onClick={() => unlink(l.id)} title="Отвязать">
                    <Unlink size={16} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mt-4">
        <h2 className="font-display text-lg font-semibold">Как пользоваться</h2>
        <div className="mt-2 space-y-1 text-sm text-ink/80">
          <p>
            <code>350 кофе</code> · <code>такси 800 вчера</code> · <code>05.11 аптека 1200</code> · <code>+50000 зарплата</code> · <code>кино 900 личное</code>
          </p>
          <p>
            Счёт — по наименованию в сообщении (<code>350 кофе альфа</code>) или по умолчанию. Категорию определяют правила, словарь магазинов, затем ИИ; поправить — кнопкой под записью.
          </p>
          <p>
            Команды: /month, /today, /budgets, /plans, /goals, /due, /balance, /report, /ask, /account, /undo.
          </p>
          <p className="text-ink/60">
            В группе бот видит обычные сообщения, только если в @BotFather отключён privacy mode (/setprivacy → Disable). Иначе пишите <code>/r 350 кофе</code>.
          </p>
        </div>
      </Card>
    </AppShell>
  );
}
