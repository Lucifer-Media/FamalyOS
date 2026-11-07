'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, Badge, ErrorText } from '@/components/ui';
import { AccountSecurity, AttemptRow, DeviceRow, SessionRow, dt } from '@/components/account-security';
import { toast } from 'sonner';
import { ArrowLeft, KeyRound, ShieldCheck, ShieldOff, UserPen } from 'lucide-react';

interface Account {
  membershipId: string;
  role: string;
  membershipStatus: string;
  isSelf: boolean;
  canManage: boolean;
  person: { id: string; fullName: string };
  user: { id: string; email: string; status: string; twoFactorEnabled: boolean; twoFactorPending: boolean; recoveryCodesRemaining: number; lastLoginAt: string | null; createdAt: string };
  sessions: SessionRow[];
  devices: DeviceRow[];
  loginAttempts: AttemptRow[];
}

const ROLE_LABELS: Record<string, string> = { OWNER: 'Владелец', PARTNER: 'Партнёр', ADULT: 'Взрослый', CHILD: 'Ребёнок', RELATIVE: 'Родственник', GUEST: 'Гость', LIMITED: 'Ограниченный' };
const input = 'w-full rounded-card border border-line bg-paper px-3 py-2 text-sm focus:border-moss-500';

export default function MemberCardPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { currentFamilySpaceId, familySpaces } = useAuth();
  const requireTwoFactor = familySpaces.find((s) => s.id === currentFamilySpaceId)?.requireTwoFactor !== false;
  const params = useParams<{ id: string }>();
  const [acc, setAcc] = useState<Account | null>(null);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState({ fullName: '', email: '' });
  const [newPassword, setNewPassword] = useState('');
  const [setup, setSetup] = useState<{ qr: string; codes: string[]; code: string } | null>(null);

  const base = `/family-spaces/${currentFamilySpaceId}/members/${params.id}/account`;
  const load = useCallback(async () => {
    if (!currentFamilySpaceId) return;
    const a = await apiFetch<Account>(base);
    setAcc(a);
    setProfile({ fullName: a.person.fullName, email: a.user.email });
  }, [base, currentFamilySpaceId]);
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

  if (loading || !isAuthenticated) return null;
  const manageOther = acc?.canManage && !acc.isSelf;

  return (
    <AppShell>
      <Link href="/members" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ArrowLeft size={14} /> Участники
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">{acc?.person.fullName ?? '…'}</h1>
      {acc && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink/60">
          <span>{acc.user.email}</span>
          <Badge>{ROLE_LABELS[acc.role] ?? acc.role}</Badge>
          {acc.membershipStatus !== 'ACTIVE' && <Badge tone="clay">{acc.membershipStatus === 'SUSPENDED' ? 'приостановлен' : acc.membershipStatus}</Badge>}
          {acc.user.twoFactorEnabled ? <Badge tone="moss">2FA</Badge> : <Badge tone="clay">без 2FA</Badge>}
          <span>последний вход {dt(acc.user.lastLoginAt)}</span>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      {acc?.isSelf && (
        <p className="mt-3 rounded-card bg-paper-dim p-3 text-sm">
          Это вы. Пароль, email и 2FA меняются в <Link href="/profile" className="underline">«Мой профиль»</Link> — там нужно подтверждение паролем.
        </p>
      )}
      {acc && !acc.canManage && !acc.isSelf && <p className="mt-3 text-sm text-ink/60">Управлять учётной записью может только владелец пространства.</p>}

      {acc?.canManage && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <UserPen size={16} className="text-ink/50" /> Данные
            </h2>
            <div className="mt-3 space-y-2">
              <label className="block text-sm">
                <span className="mb-1 block text-ink/70">ФИО</span>
                <input className={input} value={profile.fullName} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} />
              </label>
              {manageOther && (
                <label className="block text-sm">
                  <span className="mb-1 block text-ink/70">Email для входа</span>
                  <input type="email" className={input} value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
                </label>
              )}
            </div>
            <Button
              className="mt-3"
              onClick={() =>
                run(
                  () => apiFetch(base, { method: 'PATCH', body: manageOther ? profile : { fullName: profile.fullName } }),
                  'Сохранено',
                )
              }
            >
              Сохранить
            </Button>
          </Card>

          {manageOther && (
            <Card>
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
                <KeyRound size={16} className="text-ink/50" /> Новый пароль
              </h2>
              <p className="mt-1 text-xs text-ink/50">Если участник забыл пароль. Все его сеансы завершатся, запомненные устройства сбросятся.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input type="text" autoComplete="off" className={`${input} max-w-xs`} placeholder="От 10 символов" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <Button onClick={async () => (await run(() => apiFetch(`${base}/password`, { method: 'POST', body: { newPassword } }), 'Пароль установлен — передайте его участнику')) && setNewPassword('')} disabled={newPassword.length < 10}>
                  Установить
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {manageOther && acc && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <ShieldCheck size={16} className="text-ink/50" /> Двухфакторная аутентификация
            </h2>
            {acc.user.twoFactorEnabled ? <Badge tone="moss">включена · резервных кодов {acc.user.recoveryCodesRemaining}</Badge> : <Badge tone="clay">выключена</Badge>}
          </div>
          {acc.user.twoFactorEnabled ? (
            <div className="mt-3">
              <Button variant="danger" onClick={() => run(() => apiFetch(`${base}/2fa/disable`, { method: 'POST' }), requireTwoFactor ? '2FA сброшена — при следующем входе участник настроит её заново' : '2FA отключена')}>
                <ShieldOff size={16} /> {requireTwoFactor ? 'Сбросить 2FA' : 'Отключить 2FA'}
              </Button>
              <p className="mt-2 text-xs text-ink/50">
                {requireTwoFactor
                  ? 'Например, если участник сменил телефон. При следующем входе система попросит настроить 2FA заново.'
                  : '2FA в семье добровольная — после отключения участник будет входить только по паролю.'}
              </p>
            </div>
          ) : setup ? (
            <div className="animate-in mt-3 grid gap-4 sm:grid-cols-[200px_1fr]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qr} alt="QR-код для приложения-аутентификатора" width={200} height={200} className="rounded-card bg-white p-2" />
              <div>
                <p className="text-sm">Пусть участник отсканирует QR своим приложением-аутентификатором и назовёт код:</p>
                <div className="mt-2 flex gap-2">
                  <input className={`${input} w-32`} inputMode="numeric" value={setup.code} onChange={(e) => setSetup({ ...setup, code: e.target.value })} placeholder="123456" />
                  <Button onClick={async () => (await run(() => apiFetch(`${base}/2fa/confirm`, { method: 'POST', body: { code: setup.code } }), '2FA включена')) && setSetup(null)} disabled={setup.code.length < 6}>
                    Подтвердить
                  </Button>
                </div>
                <p className="mt-3 text-xs font-medium">Резервные коды — передайте участнику:</p>
                <div className="mt-1 grid grid-cols-2 gap-1 font-mono text-xs sm:grid-cols-5">
                  {setup.codes.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <Button
                onClick={async () => {
                  setError('');
                  try {
                    const r = await apiFetch<{ qrCodeDataUrl: string; recoveryCodes: string[] }>(`${base}/2fa/setup`, { method: 'POST' });
                    setSetup({ qr: r.qrCodeDataUrl, codes: r.recoveryCodes, code: '' });
                  } catch (e) {
                    setError(e instanceof ApiError ? e.message : 'Ошибка');
                  }
                }}
              >
                <ShieldCheck size={16} /> Включить 2FA вместе с участником
              </Button>
              <p className="mt-2 text-xs text-ink/50">Или участник включит её сам при следующем входе — без 2FA система всё равно не пустит дальше настройки.</p>
            </div>
          )}
        </Card>
      )}

      {acc && (acc.canManage || acc.isSelf) && (
        <AccountSecurity
          sessions={acc.sessions}
          devices={acc.devices}
          attempts={acc.loginAttempts}
          onRevokeAllSessions={manageOther ? () => run(() => apiFetch(`${base}/sessions/revoke`, { method: 'POST' }), 'Все сеансы участника завершены') : undefined}
          onRevokeDevice={manageOther ? (id) => run(() => apiFetch(`${base}/devices/${id}/revoke`, { method: 'POST' }), 'Устройство забыто') : undefined}
        />
      )}
    </AppShell>
  );
}
