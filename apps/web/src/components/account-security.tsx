'use client';

import { Button, Card, Badge } from '@/components/ui';
import { Laptop, ShieldCheck, LogOut, History } from 'lucide-react';

export interface SessionRow {
  id: string;
  label: string;
  ipAddress: string | null;
  createdAt: string;
  current?: boolean;
}
export interface DeviceRow {
  id: string;
  label: string;
  knownIps: string[];
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  active: boolean;
}
export interface AttemptRow {
  createdAt: string;
  success: boolean;
  reason: string | null;
  ipAddress: string | null;
  device: string;
}

export const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

const REASON: Record<string, string> = {
  ok: 'вход',
  trusted_device: 'вход с запомненного устройства',
  recovery_code: 'вход по резервному коду',
  invalid_password: 'неверный пароль',
  invalid_credentials: 'неверный email/пароль',
  invalid_2fa: 'неверный код 2FA',
  '2fa_required': 'запрошен код 2FA',
  '2fa_required_new_ip': 'код 2FA: новый IP',
  invalid_recovery_code: 'неверный резервный код',
};

/** Сессии + запомненные устройства + журнал входов — общий блок для «Мой профиль» и карточки участника. */
export function AccountSecurity({
  sessions,
  devices,
  attempts,
  onRevokeSession,
  onRevokeAllSessions,
  onRevokeDevice,
  revokeAllLabel = 'Завершить все сеансы',
}: {
  sessions: SessionRow[];
  devices: DeviceRow[];
  attempts?: AttemptRow[];
  onRevokeSession?: (id: string) => void;
  onRevokeAllSessions?: () => void;
  onRevokeDevice?: (id: string) => void;
  revokeAllLabel?: string;
}) {
  const activeDevices = devices.filter((d) => d.active);
  const oldDevices = devices.filter((d) => !d.active).slice(0, 5);
  return (
    <>
      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <ShieldCheck size={16} className="text-ink/50" /> Запомненные устройства
          </h2>
        </div>
        <p className="mt-1 text-xs text-ink/50">С этих браузеров вход без кода 2FA (пароль нужен всегда) — пока IP среди знакомых. Отзыв действует сразу.</p>
        <div className="mt-2 divide-y divide-line">
          {activeDevices.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{d.label}</p>
                <p className="text-xs text-ink/50">
                  IP: {d.knownIps.join(', ') || '—'} · последний вход {dt(d.lastUsedAt)} · до {dt(d.expiresAt)}
                </p>
              </div>
              {onRevokeDevice && (
                <Button variant="secondary" onClick={() => onRevokeDevice(d.id)}>
                  Забыть
                </Button>
              )}
            </div>
          ))}
          {activeDevices.length === 0 && <p className="py-2 text-sm text-ink/50">Нет. Отметьте «Запомнить это устройство» при входе с кодом 2FA.</p>}
          {oldDevices.map((d) => (
            <div key={d.id} className="py-1.5 text-xs text-ink/40">
              {d.label} — {d.revokedAt ? `отозвано ${dt(d.revokedAt)}${d.revokeReason ? ` (${d.revokeReason})` : ''}` : `истекло ${dt(d.expiresAt)}`}
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Laptop size={16} className="text-ink/50" /> Активные сеансы
          </h2>
          {onRevokeAllSessions && sessions.length > 0 && (
            <Button variant="secondary" onClick={onRevokeAllSessions}>
              <LogOut size={16} /> {revokeAllLabel}
            </Button>
          )}
        </div>
        <div className="mt-2 divide-y divide-line">
          {sessions.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <p className="font-medium">
                  {s.label} {s.current && <Badge tone="moss">этот сеанс</Badge>}
                </p>
                <p className="text-xs text-ink/50">
                  IP {s.ipAddress ?? '—'} · вход {dt(s.createdAt)}
                </p>
              </div>
              {onRevokeSession && !s.current && (
                <Button variant="ghost" onClick={() => onRevokeSession(s.id)}>
                  Завершить
                </Button>
              )}
            </div>
          ))}
          {sessions.length === 0 && <p className="py-2 text-sm text-ink/50">Активных сеансов нет.</p>}
        </div>
      </Card>

      {attempts && (
        <Card className="mt-4">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <History size={16} className="text-ink/50" /> Журнал входов
          </h2>
          <div className="mt-2 max-h-80 divide-y divide-line overflow-y-auto text-sm">
            {attempts.map((a, i) => (
              <div key={i} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span className={a.success ? '' : 'text-clay'}>
                  {dt(a.createdAt)} · {REASON[a.reason ?? ''] ?? a.reason}
                </span>
                <span className="text-xs text-ink/50">
                  {a.device} · {a.ipAddress ?? '—'}
                </span>
              </div>
            ))}
            {attempts.length === 0 && <p className="py-2 text-ink/50">Записей нет.</p>}
          </div>
        </Card>
      )}
    </>
  );
}
