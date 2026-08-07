/**
 * Человекочитаемые русские подписи для журнала аудита.
 * Ключи соответствуют строковым кодам action/resourceType, которые пишет
 * backend (см. apps/api/src/**\/*.service.ts, вызовы audit.log({ action: '...' })).
 * Если backend начнёт писать новый код действия — добавьте его сюда,
 * иначе в интерфейсе покажется исходный технический код как есть (safe fallback).
 */

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'auth.register': 'Регистрация в системе',
  'auth.login': 'Вход в систему',
  'auth.2fa.enabled': 'Включена двухфакторная аутентификация',
  'auth.2fa.disabled': 'Отключена двухфакторная аутентификация',

  'entity.create': 'Создание записи',
  'entity.update': 'Изменение записи',
  'entity.archive': 'Архивирование записи',
  'entity.unarchive': 'Восстановление записи из архива',
  'entity.void': 'Аннулирование записи',
  'entity.revert': 'Откат записи к предыдущей версии',
  'entity.link': 'Связывание записей',

  'file.upload': 'Загрузка файла',
  'file.new_version': 'Загрузка новой версии файла',
  'file.download': 'Скачивание файла',
  'file.archive': 'Архивирование файла',

  'person.create': 'Добавление профиля человека',
  'person.update': 'Изменение профиля человека',
  'person.archive': 'Архивирование профиля человека',

  'membership.invite': 'Приглашение участника',
  'membership.accept': 'Принятие приглашения',
  'membership.role_change': 'Изменение роли участника',
  'membership.status_change': 'Изменение статуса участника',
  'membership.permission_override': 'Изменение точечных прав участника',
};

export const AUDIT_RESOURCE_TYPE_LABELS: Record<string, string> = {
  User: 'Пользователь',
  Person: 'Профиль человека',
  Membership: 'Участник пространства',
  Invitation: 'Приглашение',
  FileObject: 'Файл',
  EntityLink: 'Связь между записями',
  knowledge_article: 'Статья базы знаний',
};

/** Русская подпись действия. Если код неизвестен — возвращаем как есть (не ломаем интерфейс). */
export function translateAuditAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/** Русская подпись типа объекта. Если тип неизвестен — возвращаем как есть. */
export function translateResourceType(resourceType: string | null): string {
  if (!resourceType) return '';
  return AUDIT_RESOURCE_TYPE_LABELS[resourceType] ?? resourceType;
}
