/**
 * Эвристический классификатор типа документа по распознанному тексту.
 * ЭТО НЕ AI/ML-модель — это простой поиск ключевых слов и regex-паттернов
 * реквизитов. Возвращаемая уверенность (confidence) отражает именно
 * "насколько текст похож на этот тип документа", а не гарантию
 * правильности. Результат ВСЕГДА проходит через подтверждение пользователем
 * (см. DocumentIntake) — раздел 5 ТЗ Итерации 2 требует этого явно:
 * AI не должен автоматически считать распознанные данные достоверными.
 */

export interface ClassificationResult {
  entityType: string;
  confidence: number; // 0..1, эвристическая, не статистическая
  matchedKeywords: string[];
}

interface ClassifierRule {
  entityType: string;
  keywords: string[]; // если встретилось хотя бы одно — кандидат
  strongKeywords?: string[]; // встречается — высокая уверенность
}

const RULES: ClassifierRule[] = [
  {
    entityType: 'passport_rf',
    keywords: ['паспорт', 'российская федерация'],
    strongKeywords: ['паспорт гражданина российской федерации', 'код подразделения'],
  },
  {
    entityType: 'snils',
    keywords: ['снилс', 'страховое свидетельство'],
    strongKeywords: ['страховой номер индивидуального лицевого счёта'],
  },
  {
    entityType: 'inn',
    keywords: ['инн', 'идентификационный номер налогоплательщика'],
    strongKeywords: ['свидетельство о постановке на учёт в налоговом органе'],
  },
  {
    entityType: 'foreign_passport',
    keywords: ['загранпаспорт', 'passport', 'загран'],
    strongKeywords: ['паспорт для выезда из российской федерации'],
  },
  {
    entityType: 'residence_permit',
    keywords: ['внж', 'вид на жительство'],
    strongKeywords: ['разрешение на постоянное проживание'],
  },
  {
    entityType: 'medical_conclusion',
    keywords: ['заключение', 'диагноз'],
    strongKeywords: ['медицинское заключение'],
  },
  {
    entityType: 'prescription',
    keywords: ['рецепт', 'rp:'],
    strongKeywords: ['рецептурный бланк'],
  },
  {
    entityType: 'vehicle',
    keywords: ['птс', 'свидетельство о регистрации тс', 'vin'],
    strongKeywords: ['паспорт транспортного средства'],
  },
];

export function classifyDocumentText(text: string): ClassificationResult | null {
  const normalized = text.toLowerCase();
  let best: ClassificationResult | null = null;

  for (const rule of RULES) {
    const matched = rule.keywords.filter((k) => normalized.includes(k));
    if (matched.length === 0) continue;

    const strongMatched = (rule.strongKeywords ?? []).filter((k) => normalized.includes(k));
    const confidence = strongMatched.length > 0 ? 0.85 : Math.min(0.3 + matched.length * 0.15, 0.6);

    if (!best || confidence > best.confidence) {
      best = { entityType: rule.entityType, confidence, matchedKeywords: [...matched, ...strongMatched] };
    }
  }
  return best;
}

// ---------- Извлечение реквизитов (тоже эвристика, не гарантия) ----------

const RE_PASSPORT_SERIES_NUMBER = /(\d{2}\s?\d{2})\s+(\d{6})/;
const RE_SNILS = /(\d{3}-\d{3}-\d{3}\s?\d{2})/;
const RE_INN = /\b(\d{10}|\d{12})\b/;
const RE_DATE_RU = /(\d{2})\.(\d{2})\.(\d{4})/; // ДД.ММ.ГГГГ — частый формат в бланках РФ

function ruDateToIso(match: RegExpMatchArray | null): string | undefined {
  if (!match) return undefined;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

export function extractSuggestedAttributes(
  entityType: string,
  text: string,
): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};

  if (entityType === 'passport_rf') {
    const seriesNumber = text.match(RE_PASSPORT_SERIES_NUMBER);
    if (seriesNumber) {
      attrs.series = seriesNumber[1];
      attrs.number = seriesNumber[2];
    }
    const issueDate = ruDateToIso(text.match(RE_DATE_RU));
    if (issueDate) attrs.issueDate = issueDate;
  }

  if (entityType === 'snils') {
    const snils = text.match(RE_SNILS);
    if (snils) attrs.number = snils[1];
  }

  if (entityType === 'inn') {
    const inn = text.match(RE_INN);
    if (inn) attrs.number = inn[1];
  }

  return attrs;
}
