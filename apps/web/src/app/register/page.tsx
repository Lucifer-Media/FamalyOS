'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button, Card, ErrorText, Field, Input } from '@/components/ui';

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [form, setForm] = useState({ email: '', password: '', fullName: '', familySpaceName: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(form);
      router.push('/2fa-setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось зарегистрироваться');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-semibold text-ink">Создать семью</h1>
          <p className="mt-1 text-sm text-ink/60">Вы станете владельцем нового пространства</p>
        </div>
        <Card>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Название семейного пространства">
              <Input
                required
                value={form.familySpaceName}
                onChange={(e) => setForm({ ...form, familySpaceName: e.target.value })}
                placeholder="Например: Семья Ивановых"
                autoFocus
              />
            </Field>
            <Field label="Ваше полное имя">
              <Input
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Пароль" hint="Не короче 10 символов">
              <Input
                type="password"
                required
                minLength={10}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Создаём…' : 'Создать пространство'}
            </Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-sm text-ink/60">
          Уже есть пространство?{' '}
          <Link href="/login" className="font-medium text-moss-600 underline">
            Войти
          </Link>
        </p>
      </div>
    </div>
  );
}
