/**
 * Эти union-типы структурно идентичны enum'ам, объявленным в prisma/schema.prisma
 * (FamilyRole, PermissionResource, PermissionAction, ConfidentialityLevel).
 * Вынесены отдельно, чтобы модули с чистой бизнес-логикой (например,
 * ролевая матрица прав) можно было юнит-тестировать без сгенерированного
 * Prisma Client и без поднятой БД. Если меняется schema.prisma — обязательно
 * обновить и эти списки (см. docs/ARCHITECTURE.md, раздел "Инварианты").
 */
export type FamilyRole = 'OWNER' | 'PARTNER' | 'ADULT' | 'CHILD' | 'RELATIVE' | 'GUEST' | 'LIMITED';

export type PermissionResource =
  | 'GENERAL'
  | 'DOCUMENTS'
  | 'FINANCE'
  | 'MEDICAL'
  | 'CONFIDENTIAL'
  | 'INTEGRATIONS'
  | 'USERS'
  | 'KNOWLEDGE_BASE'
  | 'FILES';

export type PermissionAction = 'VIEW' | 'CREATE' | 'EDIT' | 'ARCHIVE' | 'MANAGE';

export type ConfidentialityLevel = 'STANDARD' | 'SENSITIVE' | 'STRICTLY_CONFIDENTIAL';
