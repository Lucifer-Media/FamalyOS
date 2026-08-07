'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Field, Input } from '@/components/ui';
import { UserPlus } from 'lucide-react';

const ROLES = ['OWNER', 'PARTNER', 'ADULT', 'CHILD', 'RELATIVE', 'GUEST', 'LIMITED'];
const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Владелец',
  PARTNER: 'Партнёр',
  ADULT: 'Взрослый член семьи',
  CHILD: 'Ребёнок',
  RELATIVE: 'Родственник',
  GUEST: 'Гость',
  LIMITED: 'Ограниченный доступ',
};

interface Member {
  id: string;
  role: string;
  status: string;
  person: { fullName: string };
}

export default function MembersPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { currentFamilySpaceId, currentRole } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('ADULT');
  const [inviteToken, setInviteToken] = useState('');
  const [busy, setBusy] = useState(false);

  const canManage = ['OWNER', 'PARTNER'].includes(currentRole ?? '');

  async function load() {
    if (!currentFamilySpaceId) return;
    const data = await apiFetch<Member[]>(`/family-spaces/${currentFamilySpaceId}/members`);
    setMembers(data);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [currentFamilySpaceId]);

  async function onInvite() {
    setBusy(true);
    setError('');
    setInviteToken('');
    try {
      const res = await apiFetch<{ token: string }>(`/family-spaces/${currentFamilySpaceId}/invitations`, {
        method: 'POST',
        body: { email: inviteEmail, role: inviteRole },
      });
      setInviteToken(res.token);
      setInviteEmail('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось создать приглашение');
    } finally {
      setBusy(false);
    }
  }

  async function onChangeRole(membershipId: string, role: string) {
    await apiFetch(`/family-spaces/${currentFamilySpaceId}/members/${membershipId}/role`, {
      method: 'PATCH',
      body: { role },
    });
    await load();
  }

  async function onToggleStatus(m: Member) {
    const next = m.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    await apiFetch(`/family-spaces/${currentFamilySpaceId}/members/${m.id}/status`, {
      method: 'PATCH',
      body: { status: next },
    });
    await load();
  }

  if (loading || !isAuthenticated) return null;

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold text-ink">Участники</h1>
      <p className="mt-1 text-sm text-ink/60">
        Роли определяют права по умолчанию; точечные исключения настраиваются владельцем через API.
      </p>

      <ErrorText>{error}</ErrorText>

      {canManage && (
        <Card className="mt-4">
          <h2 className="font-display text-lg font-semibold">Пригласить участника</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
            <Field label="Email">
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </Field>
            <Field label="Роль">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="rounded-card border border-line bg-white px-3 py-2 text-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <Button onClick={onInvite} disabled={busy || !inviteEmail}>
                <UserPlus size={16} /> Пригласить
              </Button>
            </div>
          </div>
          {inviteToken && (
            <p className="mt-3 rounded-card bg-moss-50 px-3 py-2 text-xs text-moss-700">
              Приглашение создано. Ссылка для передачи (отправка email пока не подключена —
              техдолг интеграционного слоя): <br />
              <code className="font-mono">/accept-invite/{inviteToken}</code>
            </p>
          )}
        </Card>
      )}

      <Card className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-ink/50">
              <th className="py-2 pr-3 font-medium">Имя</th>
              <th className="py-2 pr-3 font-medium">Роль</th>
              <th className="py-2 pr-3 font-medium">Статус</th>
              {canManage && <th className="py-2 pr-3 font-medium"></th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-line/60 last:border-0">
                <td className="py-2 pr-3">{m.person.fullName}</td>
                <td className="py-2 pr-3">
                  {canManage ? (
                    <select
                      value={m.role}
                      onChange={(e) => onChangeRole(m.id, e.target.value)}
                      className="rounded-card border border-line bg-white px-2 py-1 text-sm"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    ROLE_LABELS[m.role] ?? m.role
                  )}
                </td>
                <td className="py-2 pr-3 text-ink/60">{m.status}</td>
                {canManage && (
                  <td className="py-2 pr-3">
                    <Button variant="secondary" onClick={() => onToggleStatus(m)}>
                      {m.status === 'ACTIVE' ? 'Приостановить' : 'Восстановить'}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </AppShell>
  );
}
