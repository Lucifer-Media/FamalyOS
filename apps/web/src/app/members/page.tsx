'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { useRequireAuth } from '@/lib/use-require-auth';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Field, Input } from '@/components/ui';
import { UserPlus, Shield, ShieldCheck, ShieldX } from 'lucide-react';

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

const RESOURCES: { value: string; label: string }[] = [
  { value: 'GENERAL', label: 'Общее' },
  { value: 'DOCUMENTS', label: 'Документы' },
  { value: 'FINANCE', label: 'Финансы' },
  { value: 'MEDICAL', label: 'Медицина' },
  { value: 'CONFIDENTIAL', label: 'Конфиденциальное' },
  { value: 'INTEGRATIONS', label: 'Интеграции' },
  { value: 'USERS', label: 'Пользователи' },
  { value: 'KNOWLEDGE_BASE', label: 'База знаний' },
  { value: 'FILES', label: 'Файлы' },
];

const ACTIONS: { value: string; label: string }[] = [
  { value: 'VIEW', label: 'Просмотр' },
  { value: 'CREATE', label: 'Создание' },
  { value: 'EDIT', label: 'Редактирование' },
  { value: 'ARCHIVE', label: 'Архивирование' },
  { value: 'MANAGE', label: 'Управление' },
];

interface Member {
  id: string;
  role: string;
  status: string;
  person: { fullName: string };
}

interface PermissionOverride {
  id: string;
  membershipId: string;
  resource: string;
  action: string;
  allowed: boolean;
}

export default function MembersPage() {
  const { loading, isAuthenticated } = useRequireAuth();
  const { currentFamilySpaceId, currentRole } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [overrides, setOverrides] = useState<Record<string, PermissionOverride[]>>({});
  const [error, setError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('ADULT');
  const [inviteToken, setInviteToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [showOverridesModal, setShowOverridesModal] = useState(false);

  const canManage = ['OWNER', 'PARTNER'].includes(currentRole ?? '');
  const isOwner = currentRole === 'OWNER';

  async function load() {
    if (!currentFamilySpaceId) return;
    const data = await apiFetch<Member[]>(`/family-spaces/${currentFamilySpaceId}/members`);
    setMembers(data);
    // Загружаем overrides только для владельца
    if (isOwner) {
      const overridesMap: Record<string, PermissionOverride[]> = {};
      for (const m of data) {
        try {
          const ov = await apiFetch<PermissionOverride[]>(
            `/family-spaces/${currentFamilySpaceId}/members/${m.id}/permission-overrides`,
          );
          overridesMap[m.id] = ov;
        } catch {
          overridesMap[m.id] = [];
        }
      }
      setOverrides(overridesMap);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [currentFamilySpaceId, isOwner]);

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

  async function onLoadOverrides(membershipId: string) {
    if (!isOwner) return;
    try {
      const ov = await apiFetch<PermissionOverride[]>(
        `/family-spaces/${currentFamilySpaceId}/members/${membershipId}/permission-overrides`,
      );
      setOverrides((prev) => ({ ...prev, [membershipId]: ov }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить исключения');
    }
  }

  async function onSaveOverride(
    membershipId: string,
    resource: string,
    action: string,
    allowed: boolean,
  ) {
    try {
      await apiFetch(
        `/family-spaces/${currentFamilySpaceId}/members/${membershipId}/permission-overrides`,
        {
          method: 'POST',
          body: { resource, action, allowed },
        },
      );
      await onLoadOverrides(membershipId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить исключение');
    }
  }

  async function onDeleteOverride(membershipId: string, overrideId: string) {
    try {
      await apiFetch(
        `/family-spaces/${currentFamilySpaceId}/members/${membershipId}/permission-overrides/${overrideId}`,
        { method: 'DELETE' },
      );
      await onLoadOverrides(membershipId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось удалить исключение');
    }
  }

  function openOverridesModal(membershipId: string) {
    setSelectedMemberId(membershipId);
    setShowOverridesModal(true);
    onLoadOverrides(membershipId);
  }

  function closeOverridesModal() {
    setShowOverridesModal(false);
    setSelectedMemberId(null);
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
              {isOwner && <th className="py-2 pr-3 font-medium">Исключения</th>}
              {canManage && !isOwner && <th className="py-2 pr-3 font-medium"></th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const memberOverrides = overrides[m.id] || [];
              return (
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
                  {isOwner && (
                    <td className="py-2 pr-3">
                      <Button
                        variant="secondary"
                        onClick={() => openOverridesModal(m.id)}
                        className="flex items-center gap-2"
                      >
                        <Shield size={14} />
                        {memberOverrides.length > 0
                          ? `${memberOverrides.length} исключений`
                          : 'Настроить'}
                      </Button>
                    </td>
                  )}
                  {canManage && !isOwner && (
                    <td className="py-2 pr-3">
                      <Button variant="secondary" onClick={() => onToggleStatus(m)}>
                        {m.status === 'ACTIVE' ? 'Приостановить' : 'Восстановить'}
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {showOverridesModal && selectedMemberId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-3xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                <ShieldCheck size={20} />
                Исключения прав участника
              </h2>
              <button onClick={closeOverridesModal} className="text-ink/60 hover:text-ink">
                ✕
              </button>
            </div>

            <div className="mt-4">
              <p className="text-sm text-ink/60 mb-4">
                Добавьте точечные разрешения или запреты, которые переопределяют права по умолчанию для роли.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end mb-4">
                <Field label="Ресурс">
                  <select
                    id="override-resource"
                    className="w-full rounded-card border border-line bg-white px-3 py-2 text-sm"
                  >
                    {RESOURCES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Действие">
                  <select
                    id="override-action"
                    className="w-full rounded-card border border-line bg-white px-3 py-2 text-sm"
                  >
                    {ACTIONS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      const resourceEl = document.getElementById('override-resource') as HTMLSelectElement;
                      const actionEl = document.getElementById('override-action') as HTMLSelectElement;
                      if (resourceEl && actionEl) {
                        onSaveOverride(selectedMemberId, resourceEl.value, actionEl.value, true);
                      }
                    }}
                  >
                    <ShieldCheck size={16} /> Разрешить
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const resourceEl = document.getElementById('override-resource') as HTMLSelectElement;
                      const actionEl = document.getElementById('override-action') as HTMLSelectElement;
                      if (resourceEl && actionEl) {
                        onSaveOverride(selectedMemberId, resourceEl.value, actionEl.value, false);
                      }
                    }}
                  >
                    <ShieldX size={16} /> Запретить
                  </Button>
                </div>
              </div>

              <div className="mt-6">
                <h3 className="font-display text-sm font-semibold text-ink/70 mb-2">Текущие исключения</h3>
                {(!overrides[selectedMemberId] || overrides[selectedMemberId].length === 0) ? (
                  <p className="text-sm text-ink/50">Нет настроенных исключений</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-ink/50">
                        <th className="py-2 pr-3 font-medium">Ресурс</th>
                        <th className="py-2 pr-3 font-medium">Действие</th>
                        <th className="py-2 pr-3 font-medium">Статус</th>
                        <th className="py-2 pr-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {overrides[selectedMemberId].map((ov) => (
                        <tr key={ov.id} className="border-b border-line/60 last:border-0">
                          <td className="py-2 pr-3">
                            {RESOURCES.find((r) => r.value === ov.resource)?.label || ov.resource}
                          </td>
                          <td className="py-2 pr-3">
                            {ACTIONS.find((a) => a.value === ov.action)?.label || ov.action}
                          </td>
                          <td className="py-2 pr-3">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                                ov.allowed
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {ov.allowed ? 'Разрешено' : 'Запрещено'}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            <button
                              onClick={() => onDeleteOverride(selectedMemberId, ov.id)}
                              className="text-red-600 hover:text-red-700 text-xs"
                            >
                              Удалить
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="mt-6 border-t border-line pt-4 flex justify-end">
              <Button onClick={closeOverridesModal}>Закрыть</Button>
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
