/**
 * Сравнивает уже сохранённые значения полей сущности с новыми, предложенными
 * OCR-конвейером при переобработке документа. Возвращает только те поля,
 * где есть РЕАЛЬНОЕ расхождение — раздел 3 ТЗ Итерации 2: "OCR имеет право
 * предлагать значения, но не должен молча изменять уже подтверждённые
 * пользователем данные".
 */
export interface FieldConflict {
  field: string;
  currentValue: unknown;
  suggestedValue: unknown;
  suggestedConfidence?: number;
}

export function computeFieldConflicts(
  currentAttributes: Record<string, unknown>,
  suggestedAttributes: Record<string, unknown>,
  suggestedFieldConfidence: Record<string, number> = {},
): FieldConflict[] {
  return Object.entries(suggestedAttributes)
    .filter(([key, suggestedValue]) => {
      const current = currentAttributes[key];
      const hasCurrentValue = current !== undefined && current !== null && current !== '';
      return hasCurrentValue && current !== suggestedValue;
    })
    .map(([field, suggestedValue]) => ({
      field,
      currentValue: currentAttributes[field],
      suggestedValue,
      suggestedConfidence: suggestedFieldConfidence[field],
    }));
}
