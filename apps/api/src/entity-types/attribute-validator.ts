import { getEntityTypeSchema } from './entity-type-registry';
import { FieldSchema } from './field-schema.types';

export interface AttributeValidationResult {
  valid: boolean;
  errors: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

function validateField(field: FieldSchema, value: unknown, errors: string[]) {
  const present = value !== undefined && value !== null && value !== '';

  if (field.required && !present) {
    errors.push(`Поле «${field.label}» обязательно для заполнения`);
    return;
  }
  if (!present) return; // необязательное и пустое — ок

  switch (field.type) {
    case 'string':
    case 'text':
    case 'link':
      if (typeof value !== 'string') {
        errors.push(`Поле «${field.label}» должно быть строкой`);
      }
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`Поле «${field.label}» должно быть числом`);
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`Поле «${field.label}» должно быть true/false`);
      }
      break;
    case 'date':
      if (typeof value !== 'string' || !DATE_RE.test(value)) {
        errors.push(`Поле «${field.label}» должно быть датой в формате ГГГГ-ММ-ДД`);
      }
      break;
    case 'enum':
      if (typeof value !== 'string' || !(field.enumValues ?? []).includes(value)) {
        errors.push(
          `Поле «${field.label}» должно быть одним из: ${(field.enumValues ?? []).join(', ')}`,
        );
      }
      break;
  }
}

/**
 * Проверяет attributes сущности против декларативной схемы её entityType.
 * Если тип не зарегистрирован в реестре (например, 'knowledge_article' —
 * тип из Итерации 1, или будущий пользовательский тип) — валидация
 * пропускается, а не блокирует сохранение: реестр — это дополнительная
 * строгость для известных типов, а не единственный способ создать Entity.
 */
export function validateEntityAttributes(
  entityType: string,
  attributes: Record<string, unknown>,
): AttributeValidationResult {
  const schema = getEntityTypeSchema(entityType);
  if (!schema) {
    return { valid: true, errors: [] };
  }
  const errors: string[] = [];
  for (const field of schema.fields) {
    validateField(field, attributes?.[field.key], errors);
  }
  // Явная защита: пароли никогда не должны попадать в attributes ни одного типа
  // (раздел 13 ТЗ Итерации 2 — пароли только в менеджере секретов).
  const suspiciousKeys = Object.keys(attributes ?? {}).filter((k) =>
    /password|секрет(?!ManagerNote)|pass\b/i.test(k),
  );
  if (suspiciousKeys.length > 0) {
    errors.push(
      `Поля [${suspiciousKeys.join(', ')}] похожи на пароль/секрет — Family OS не хранит пароли напрямую, используйте ссылку на менеджер секретов`,
    );
  }
  return { valid: errors.length === 0, errors };
}
