'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Field, Input } from '@/components/ui';
import { ShieldCheck } from 'lucide-react';

export default function TwoFactorRecoveryPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onLoginWithRecovery() {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/auth/login/recovery', {
        method: 'POST',
        body: { email, recoveryCode },
      });
      localStorage.setItem('familyos_access_token', res.accessToken);
      localStorage.setItem('familyos_refresh_token', res.refreshToken);
      
      if (res.recoveryCodesRemaining !== undefined) {
        alert(`Вход выполнен. Осталось recovery-кодов: ${res.recoveryCodesRemaining}`);
      }
      
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Неверный email или recovery-код');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-moss-100">
            <ShieldCheck className="text-moss-600" size={24} />
          </div>
          <h1 className="font-display text-2xl font-semibold text-ink">
            Вход через recovery-код
          </h1>
          <p className="mt-1 text-sm text-ink/60">
            Если у вас нет доступа к приложению-аутентификатору, используйте один из резервных кодов.
          </p>
        </div>
        <Card className="space-y-4">
          <Field label="Email">
            <Input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              placeholder="you@example.com"
              autoFocus
            />
          </Field>
          <Field label="Recovery-код">
            <Input 
              value={recoveryCode} 
              onChange={(e) => setRecoveryCode(e.target.value)} 
              placeholder="xxxxxxxxxx"
              autoComplete="off"
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button className="w-full" onClick={onLoginWithRecovery} disabled={busy || !email || !recoveryCode}>
            {busy ? 'Проверяем…' : 'Войти с recovery-кодом'}
          </Button>
          <div className="pt-2 text-center">
            <a href="/login" className="text-sm text-link hover:underline">
              ← Вернуться к обычному входу
            </a>
          </div>
        </Card>
        <div className="mt-4 rounded-card bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-medium">Важно:</p>
          <ul className="mt-1 list-disc pl-4 space-y-1">
            <li>Recovery-код одноразовый — после использования он удаляется</li>
            <li>Если использовали все коды, настройте 2FA заново после входа</li>
            <li>Храните recovery-коды в надёжном месте (менеджер паролей, сейф)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
