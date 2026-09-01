'use client';

import { useState, useRef, useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { Send, Sparkles, FileText, Loader2 } from 'lucide-react';

interface ChatSource {
  id: string;
  entityType: string;
  title: string;
  url: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  sources?: ChatSource[];
  error?: boolean;
}

export default function AssistantPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function onAsk() {
    const question = input.trim();
    if (!question || asking) return;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setAsking(true);
    try {
      const result = await apiFetch<{ answer: string; sources: ChatSource[] }>('/ai-assistant/chat', {
        method: 'POST',
        body: { question },
      });
      setMessages((m) => [...m, { role: 'assistant', text: result.answer, sources: result.sources }]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Ассистент не ответил — попробуйте ещё раз.';
      setMessages((m) => [...m, { role: 'assistant', text: msg, error: true }]);
    } finally {
      setAsking(false);
    }
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <div className="flex items-center gap-2">
        <Sparkles size={22} className="text-clay" />
        <h1 className="font-display text-2xl font-semibold text-ink">Семейный ассистент</h1>
      </div>
      <p className="mt-1 text-sm text-ink/60">
        Отвечает только на основе того, что реально загружено в вашу базу — не выдумывает данные. Локальная модель,
        ничего не уходит в интернет.
      </p>

      <Card className="mt-4 flex h-[60vh] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {messages.length === 0 && (
            <p className="text-sm text-ink/40">
              Спросите что-нибудь, например: «Когда истекает срок действия моего паспорта?» или «Сколько мы потратили
              на ЖКХ в этом месяце?»
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'animate-fade-in flex justify-start'}>
              <div
                className={`max-w-[80%] rounded-card px-4 py-2 text-sm ${
                  m.role === 'user'
                    ? 'bg-ink text-paper'
                    : m.error
                      ? 'bg-clay/10 text-clay'
                      : 'bg-paper-dim text-ink'
                }`}
              >
                <p className="whitespace-pre-wrap">{m.text}</p>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-line/50 pt-2">
                    <p className="text-xs text-ink/40">Источники:</p>
                    {m.sources.map((s) => (
                      <a
                        key={s.id}
                        href={s.url}
                        className="flex items-center gap-1 text-xs text-clay hover:underline"
                      >
                        <FileText size={12} /> {s.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {asking && (
            <div className="flex items-center gap-2 text-sm text-ink/40">
              <Loader2 size={14} className="animate-spin" /> Ассистент думает (может занять до минуты)…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="mt-3 flex gap-2 border-t border-line pt-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAsk()}
            placeholder="Спросите об документах, финансах, ЖКХ…"
            className="flex-1 rounded-card border border-line bg-paper px-3 py-2 text-sm"
            disabled={asking}
          />
          <Button onClick={onAsk} disabled={asking || !input.trim()}>
            <Send size={16} />
          </Button>
        </div>
      </Card>
    </AppShell>
  );
}
