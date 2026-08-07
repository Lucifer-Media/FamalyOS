'use client';

import { FormEvent, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Button, Card, ErrorText, Field, Input } from '@/components/ui';

export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch(`/invitations/${params.token}/accept-new-user`, {
        method: 'POST',
        body: { fullName, password },
        skipAuth: true,
      });
      // После принятия приглашения нужен обычный вход (2FA обязательна) —
      // не выдаём токены автоматически из этого эндпоинта.
      router.push('/login?joined=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось принять приглашение');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center font-display text-2xl font-semibold text-ink">
          Присоединиться к семейному пространству
        </h1>
        <Card>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Ваше полное имя">
              <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
            </Field>
            <Field label="Придумайте пароль" hint="Не короче 10 символов">
              <Input
                type="password"
                required
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Присоединяемся…' : 'Присоединиться'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
