/**
 * Сопоставление текстовой категории (из банковской выписки при импорте)
 * со справочником `financial_category`. Специально КОНСЕРВАТИВНО — только
 * точное совпадение по названию без учёта регистра/пробелов по краям.
 * Если совпадения нет — операция должна импортироваться БЕЗ категории, а
 * не с ошибочно угаданной (пункт запроса на доработку: "если не
 * получается сопоставить категории — транзакции должны импортироваться
 * или без категории, или говорить, что надо выбрать корректную
 * категорию" — здесь реализована первая часть, вторая — на фронтенде,
 * визуальным предупреждением в предпросмотре импорта).
 */

export interface CategoryOption {
  id: string;
  name: string;
}

export function matchCategoryByName(text: string | undefined | null, categories: CategoryOption[]): string | undefined {
  if (!text) return undefined;
  const normalized = text.trim().toLowerCase();
  if (!normalized) return undefined;
  const exact = categories.find((c) => c.name.trim().toLowerCase() === normalized);
  return exact?.id;
}
