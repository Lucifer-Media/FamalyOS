'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { apiFetch, ApiError, getRefreshToken, setDeviceToken } from '@/lib/api';
import { Button, Card, Badge, ErrorText } from '@/components/ui';
import { AccountSecurity, DeviceRow, SessionRow, dt } from '@/components/account-security';
import { toast } from 'sonner';
import { KeyRound, Mail, ShieldCheck, ShieldOff, RefreshCw } from 'lucide-react';

interface Me {
  id: string;
  email: string;
  twoFactorEnabled: boolean;
  recoveryCodesRemaining: number;
  lastLoginAt: string | null;
  createdAt: string;
}

const input = 'w-full rounded-card border border-line bg-paper px-3 py-2 text-sm focus:border-moss-500';

export default function ProfilePage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [error, setError] = useState('');
  const [pwd, setPwd] = useState({ current: '', next: '', repeat: '' });
  const [mail, setMail] = useState({ email: '', password: '' });
  const [twofa, setTwofa] = useState<{ mode: 'disable' | 'codes' | null; password: string; codes?: string[] }>({ mode: null, password: '' });

  const load = useCallback(async () => {
    const [m, s, d] = await Promise.all([apiFetch<Me>('/auth/me'), apiFetch<SessionRow[]>('/auth/sessions'), apiFetch<DeviceRow[]>('/auth/devices')]);
    setMe(m);
    setSessions(s);
    setDevices(d);
  }, []);
  useEffect(() => {
    if (isAuthenticated) load().catch((e) => setError(e.message));
  }, [isAuthenticated, load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError('');
    try {
      await fn();
      toast.success(ok);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка');
      return false;
    }
  };

  async function changePassword() {
    if (pwd.next !== pwd.repeat) return setError('Новый пароль и повтор не совпадают');
    const done = await run(() => apiFetch('/auth/password', { method: 'POST', body: { currentPassword: pwd.current, newPassword: pwd.next } }), 'Пароль изменён. Другие сеансы завершены, запомненные устройства сброшены');
    if (done && me) {
      setDeviceToken(me.email, null);
      setPwd({ current: '', next: '', repeat: '' });
    }
  }

  async function changeEmail() {
    const old = me?.email;
    const done = await run(() => apiFetch('/auth/email', { method: 'POST', body: { password: mail.password, email: mail.email } }), 'Email изменён — входите с новым');
    if (done && old) setDeviceToken(old, null);
    if (done) setMail({ email: '', password: '' });
  }

  async function disable2fa() {
    const done = await run(() => apiFetch('/auth/2fa/disable', { method: 'POST', body: { password: twofa.password } }), '2FA отключена');
    if (done) setTwofa({ mode: null, password: '' });
  }

  async function regenerateCodes() {
    setError('');
    try {
      const res = await apiFetch<{ recoveryCodes: string[] }>('/auth/2fa/recovery/regenerate', { method: 'POST', body: { password: twofa.password } });
      setTwofa({ mode: 'codes', password: '', codes: res.recoveryCodes });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка');
    }
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold text-ink">Мой профиль</h1>
      <p className="mt-1 text-sm text-ink/60">
        {me?.email} · последний вход {dt(me?.lastLoginAt)}
      </p>
      <ErrorText>{error}</ErrorText>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <KeyRound size={16} className="text-ink/50" /> Пароль
          </h2>
          <div className="mt-3 space-y-2">
            <input type="password" autoComplete="current-password" className={input} placeholder="Текущий пароль" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} />
            <input type="password" autoComplete="new-password" className={input} placeholder="Новый пароль (от 10 символов)" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} />
            <input type="password" autoComplete="new-password" className={input} placeholder="Повторите новый пароль" value={pwd.repeat} onChange={(e) => setPwd({ ...pwd, repeat: e.target.value })} />
          </div>
          <Button className="mt-3" onClick={changePassword} disabled={!pwd.current || !pwd.next}>
            Сменить пароль
          </Button>
          <p className="mt-2 text-xs text-ink/50">Остальные сеансы завершатся, запомненные устройства сбросятся.</p>
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Mail size={16} className="text-ink/50" /> Email для входа
          </h2>
          <div className="mt-3 space-y-2">
            <input type="email" className={input} placeholder={me?.email ?? 'Новый email'} value={mail.email} onChange={(e) => setMail({ ...mail, email: e.target.value })} />
            <input type="password" autoComplete="current-password" className={input} placeholder="Пароль для подтверждения" value={mail.password} onChange={(e) => setMail({ ...mail, password: e.target.value })} />
          </div>
          <Button className="mt-3" onClick={changeEmail} disabled={!mail.email || !mail.password}>
            Сменить email
          </Button>
        </Card>
      </div>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <ShieldCheck size={16} className="text-ink/50" /> Двухфакторная аутентификация
          </h2>
          {me && (me.twoFactorEnabled ? <Badge tone="moss">включена</Badge> : <Badge tone="clay">выключена</Badge>)}
        </div>
        {me?.twoFactorEnabled ? (
          <>
            <p className="mt-1 text-sm text-ink/60">Резервных кодов осталось: {me.recoveryCodesRemaining}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setTwofa({ mode: 'codes', password: '' })}>
                <RefreshCw size={16} /> Новые резервные коды
              </Button>
              <Button variant="ghost" onClick={() => setTwofa({ mode: 'disable', password: '' })}>
                <ShieldOff size={16} /> Отключить / перенастроить
              </Button>
            </div>
            {twofa.mode && !twofa.codes && (
              <div className="animate-in mt-3 flex flex-wrap gap-2">
                <input type="password" className={`${input} max-w-xs`} placeholder="Пароль для подтверждения" value={twofa.password} onChange={(e) => setTwofa({ ...twofa, password: e.target.value })} />
                <Button variant={twofa.mode === 'disable' ? 'danger' : 'primary'} onClick={twofa.mode === 'disable' ? disable2fa : regenerateCodes} disabled={!twofa.password}>
                  {twofa.mode === 'disable' ? 'Отключить 2FA' : 'Выпустить коды'}
                </Button>
              </div>
            )}
            {twofa.codes && (
              <div className="animate-in mt-3 rounded-card bg-paper-dim p-3">
                <p className="text-sm font-medium">Сохраните коды — каждый одноразовый, старые больше не действуют:</p>
                <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">
                  {twofa.codes.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="mt-2">
            <p className="text-sm text-ink/60">Family OS требует 2FA для всех участников.</p>
            <Button className="mt-2" onClick={() => router.push('/2fa-setup')}>
              Включить 2FA
            </Button>
          </div>
        )}
      </Card>

      <AccountSecurity
        sessions={sessions}
        devices={devices}
        onRevokeSession={(id) => run(() => apiFetch(`/auth/sessions/${id}/revoke`, { method: 'POST' }), 'Сеанс завершён')}
        onRevokeAllSessions={() => run(() => apiFetch('/auth/sessions/revoke-others', { method: 'POST', body: { refreshToken: getRefreshToken() } }), 'Остальные сеансы завершены')}
        revokeAllLabel="Завершить остальные"
        onRevokeDevice={(id) => run(() => apiFetch(`/auth/devices/${id}/revoke`, { method: 'POST' }), 'Устройство забыто')}
      />
    </AppShell>
  );
}
