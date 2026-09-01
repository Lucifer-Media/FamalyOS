/**
 * Метаданные полей специализированных типов сущностей Итерации 2.
 * Один источник правды используется и для валидации на backend, и для
 * генерации форм на frontend (там лежит зеркальная копия — см.
 * apps/web/src/lib/entity-schemas.ts — техдолг: вынести в общий пакет,
 * см. docs/TECH_DEBT.md).
 */

export type FieldType = 'string' | 'text' | 'date' | 'number' | 'boolean' | 'enum' | 'link';

export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  enumValues?: string[];
  /** Для type='link' — на какой entityType обычно ссылается (не enforced строго, справочно). */
  linkTarget?: string;
  /** Поле управляется отдельным специализированным UI-компонентом (например,
   * структурированные статьи расхода ЖКХ) — общая форма его не показывает,
   * чтобы не путать пользователя сырым JSON. */
  hiddenFromGenericForm?: boolean;
}

export interface EntityTypeSchema {
  entityType: string;
  labelSingular: string;
  labelPlural: string;
  resource: 'DOCUMENTS' | 'MEDICAL' | 'FINANCE';
  fields: FieldSchema[];
  /** Дочерние типы, создаваемые как отдельные связанные сущности (например, регистрации паспорта). */
  childTypes?: string[];
  /** Поддерживает иерархию через parentEntityId (сейчас — только локации). */
  hierarchical?: boolean;
}
