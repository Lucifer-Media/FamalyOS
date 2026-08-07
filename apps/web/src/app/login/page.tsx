'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await login(email, password, twoFactorCode || undefined);
      if (res.twoFactorSetupRequired) {
        router.push('/2fa-setup');
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      if (err instanceof ApiError && err.message.includes('двухфактор')) {
        setNeedsTwoFactor(true);
      }
      setError(err instanceof Error ? err.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-semibold text-ink">Family OS</h1>
          <p className="mt-1 text-sm text-ink/60">Цифровая память семьи</p>
        </div>
        <Card>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Email">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Field>
            <Field label="Пароль">
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {needsTwoFactor && (
              <Field label="Код двухфакторной аутентификации" hint="Из приложения-аутентификатора">
                <Input
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  autoFocus
                  inputMode="numeric"
                />
              </Field>
            )}
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Входим…' : 'Войти'}
            </Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-sm text-ink/60">
          Нет пространства?{' '}
          <Link href="/register" className="font-medium text-moss-600 underline">
            Создать семейное пространство
          </Link>
        </p>
      </div>
    </div>
  );
}
