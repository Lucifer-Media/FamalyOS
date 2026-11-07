'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Button, Card, ErrorText, Field, Input } from '@/components/ui';

export default function TwoFactorSetupPage() {
  const router = useRouter();
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  // Итерация 4.2: если владелец выключил обязательную 2FA — настройку можно пропустить.
  const [required, setRequired] = useState(true);

  useEffect(() => {
    apiFetch<{ twoFactorRequired: boolean }>('/auth/me')
      .then((me) => setRequired(me.twoFactorRequired !== false))
      .catch(() => undefined);
    apiFetch('/auth/2fa/setup', { method: 'POST' })
      .then((res) => {
        setQrCodeDataUrl(res.qrCodeDataUrl);
        setRecoveryCodes(res.recoveryCodes);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function onConfirm() {
    setBusy(true);
    setError('');
    try {
      await apiFetch('/auth/2fa/confirm', { method: 'POST', body: { code } });
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неверный код');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="font-display text-2xl font-semibold text-ink">
            Настройте двухфакторную аутентификацию
          </h1>
          <p className="mt-1 text-sm text-ink/60">
            {required
              ? 'Family OS требует 2FA для всех участников — это защищает семейные данные.'
              : '2FA в вашей семье добровольная, но очень рекомендуется — она защищает семейные данные.'}
          </p>
        </div>
        <Card className="space-y-4">
          {loading && <p className="text-sm text-ink/60">Загрузка…</p>}
          {qrCodeDataUrl && (
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrCodeDataUrl} alt="QR-код для приложения-аутентификатора" width={200} height={200} />
            </div>
          )}
          <p className="text-sm text-ink/70">
            Отсканируйте QR-код в приложении-аутентификаторе (Google Authenticator, Aegis, 1Password и т.п.),
            затем введите 6-значный код для подтверждения.
          </p>
          {recoveryCodes.length > 0 && (
            <div className="rounded-card bg-paper-dim p-3">
              <p className="mb-2 text-xs font-medium text-ink/70">
                Резервные коды восстановления (сохраните в надёжном месте — показываются один раз):
              </p>
              <div className="grid grid-cols-2 gap-1 font-mono text-xs text-ink/80">
                {recoveryCodes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
            </div>
          )}
          <Field label="Код из приложения">
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoFocus />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button className="w-full" onClick={onConfirm} disabled={busy || code.length < 6}>
            {busy ? 'Проверяем…' : 'Подтвердить и продолжить'}
          </Button>
          {!required && (
            <Button variant="ghost" className="w-full" onClick={() => router.push('/dashboard')}>
              Пропустить — без 2FA
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}
