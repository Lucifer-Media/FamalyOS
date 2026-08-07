import { FamilyRole, PermissionAction, PermissionResource } from './enums';

/**
 * Ролевая матрица прав по умолчанию.
 * Это отправная точка; точечные исключения хранятся в
 * MembershipPermissionOverride и имеют приоритет над этой матрицей.
 *
 * Ресурсы соответствуют разделу 34 концепции проекта:
 * просмотр / создание / изменение / архивирование / финансы / медицина /
 * документы / строго конфиденциальное / интеграции / пользователи.
 */
export type PermissionMatrix = Record<
  FamilyRole,
  Partial<Record<PermissionResource, PermissionAction[]>>
>;

const ALL_ACTIONS: PermissionAction[] = ['VIEW', 'CREATE', 'EDIT', 'ARCHIVE', 'MANAGE'];
const RW: PermissionAction[] = ['VIEW', 'CREATE', 'EDIT', 'ARCHIVE'];
const RO: PermissionAction[] = ['VIEW'];

export const DEFAULT_PERMISSION_MATRIX: PermissionMatrix = {
  OWNER: {
    GENERAL: ALL_ACTIONS,
    DOCUMENTS: ALL_ACTIONS,
    FINANCE: ALL_ACTIONS,
    MEDICAL: ALL_ACTIONS,
    CONFIDENTIAL: ALL_ACTIONS,
    INTEGRATIONS: ALL_ACTIONS,
    USERS: ALL_ACTIONS,
    KNOWLEDGE_BASE: ALL_ACTIONS,
    FILES: ALL_ACTIONS,
  },
  PARTNER: {
    GENERAL: ALL_ACTIONS,
    DOCUMENTS: ALL_ACTIONS,
    FINANCE: ALL_ACTIONS,
    MEDICAL: ALL_ACTIONS,
    CONFIDENTIAL: RW,
    INTEGRATIONS: RO,
    USERS: RO,
    KNOWLEDGE_BASE: ALL_ACTIONS,
    FILES: ALL_ACTIONS,
  },
  ADULT: {
    GENERAL: RW,
    DOCUMENTS: RW,
    FINANCE: RO,
    MEDICAL: RO,
    CONFIDENTIAL: [],
    INTEGRATIONS: [],
    USERS: RO,
    KNOWLEDGE_BASE: RW,
    FILES: RW,
  },
  CHILD: {
    GENERAL: RO,
    DOCUMENTS: RO,
    FINANCE: [],
    MEDICAL: RO,
    CONFIDENTIAL: [],
    INTEGRATIONS: [],
    USERS: [],
    KNOWLEDGE_BASE: RO,
    FILES: RO,
  },
  RELATIVE: {
    GENERAL: RO,
    DOCUMENTS: [],
    FINANCE: [],
    MEDICAL: [],
    CONFIDENTIAL: [],
    INTEGRATIONS: [],
    USERS: [],
    KNOWLEDGE_BASE: RO,
    FILES: [],
  },
  GUEST: {
    GENERAL: RO,
    DOCUMENTS: [],
    FINANCE: [],
    MEDICAL: [],
    CONFIDENTIAL: [],
    INTEGRATIONS: [],
    USERS: [],
    KNOWLEDGE_BASE: [],
    FILES: [],
  },
  LIMITED: {
    GENERAL: RO,
    DOCUMENTS: [],
    FINANCE: [],
    MEDICAL: [],
    CONFIDENTIAL: [],
    INTEGRATIONS: [],
    USERS: [],
    KNOWLEDGE_BASE: [],
    FILES: [],
  },
};

export function roleAllows(
  role: FamilyRole,
  resource: PermissionResource,
  action: PermissionAction,
): boolean {
  const allowed = DEFAULT_PERMISSION_MATRIX[role]?.[resource] ?? [];
  return allowed.includes(action) || allowed.includes('MANAGE');
}
