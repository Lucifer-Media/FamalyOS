/**
 * Определяет, какие типы сущностей стоит подтянуть НАПРЯМУЮ (по свежести,
 * а не по совпадению слов), исходя из темы вопроса. Найдено на практике:
 * вопрос «расскажи про финансовые операции» не содержит НИ ОДНОГО слова,
 * которое встречается в самих операциях (там названия банков, MCC-категории
 * латиницей) — обычный полнотекстовый поиск по такому вопросу возвращает
 * пусто, хотя данные реально есть. Для тематических вопросов ("финансы",
 * "ЖКХ") нужна не поиск по словам, а прямая выборка последних записей
 * нужного типа — см. AiChatService.ask.
 */
const TOPIC_ENTITY_TYPES: [RegExp, string[]][] = [
  [/финанс|расход|доход|потрат|трат|операци|перевод|бюджет/i, ['financial_transaction', 'bank_account', 'budget']],
  [/жкх|квитанци|счётчик|счетчик|коммунал|электроэнерг|отоплен|водосна/i, ['utility_bill', 'utility_meter', 'meter_reading']],
  [/паспорт/i, ['passport_rf', 'foreign_passport']],
  [/медицин|врач|анализ|диагноз|рецепт|болезн/i, ['medical_visit', 'medical_conclusion', 'prescription', 'lab_result']],
];

export function detectTopicEntityTypes(question: string): string[] {
  const types = new Set<string>();
  for (const [pattern, entityTypes] of TOPIC_ENTITY_TYPES) {
    if (pattern.test(question)) entityTypes.forEach((t) => types.add(t));
  }
  return Array.from(types);
}

/** Краткое текстовое представление атрибутов сущности для передачи модели
 * как контекст (когда сущность найдена не поиском, а прямой выборкой по
 * теме — у нас нет готового сниппета ts_headline, собираем сами). */
export function summarizeAttributes(attributes: Record<string, unknown>): string {
  return Object.entries(attributes)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
    .slice(0, 500);
}
