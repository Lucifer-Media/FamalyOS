/**
 * Эвристический классификатор типа документа по распознанному тексту.
 * ЭТО НЕ AI/ML-модель — это простой поиск ключевых слов и regex-паттернов
 * реквизитов. Возвращаемая уверенность (confidence) отражает именно
 * "насколько текст похож на этот тип документа", а не гарантию
 * правильности. Результат ВСЕГДА проходит через подтверждение пользователем
 * (см. DocumentIntake) — раздел 5 ТЗ Итерации 2 требует этого явно:
 * AI не должен автоматически считать распознанные данные достоверными.
 */

/**
 * Эвристический классификатор типа документа по распознанному тексту.
 * ЭТО НЕ AI/ML-модель — это простой поиск ключевых слов и regex-паттернов
 * реквизитов. Возвращаемая уверенность (confidence) отражает именно
 * "насколько текст похож на этот тип документа", а не гарантию
 * правильности. Результат ВСЕГДА проходит через подтверждение пользователем
 * (см. DocumentIntake) — раздел 5 ТЗ Итерации 2 требует этого явно:
 * AI не должен автоматически считать распознанные данные достоверными.
 *
 * ВАЖНЫЙ УРОК (баг из реального использования): многие документы УПОМИНАЮТ
 * паспортные данные, не являясь паспортом — например, трудовой договор
 * содержит "паспорт серия ... кем выдан ..." в разделе реквизитов
 * работника. Поэтому:
 *   1. У каждого правила есть MIN_CONFIDENCE_TO_SUGGEST — ниже этого порога
 *      классификатор возвращает null (не гадает), а не "лучшее из плохого".
 *   2. Слабые ключевые слова (упоминание где-то в тексте) НЕ побеждают
 *      сильные ключевые слова другого типа — итоговая уверенность
 *      конкретного правила снижается, если найдены сильные признаки
 *      КОНКУРИРУЮЩЕГО типа (см. suppressedBy).
 */

export interface ClassificationResult {
  entityType: string;
  confidence: number; // 0..1, эвристическая, не статистическая
  matchedKeywords: string[];
}

interface ClassifierRule {
  entityType: string;
  keywords: string[]; // слабый сигнал — встретилось хотя бы одно слово/фраза
  strongKeywords?: string[]; // характерная фраза именно ЭТОГО типа документа — высокая уверенность
  /** Если в тексте найдены strongKeywords одного из этих типов — этот тип подавляется
   * (не предлагается вообще), даже если у него самого есть слабые совпадения.
   * Решает проблему "паспорт упомянут внутри трудового договора". */
  suppressedByStrongMatchOf?: string[];
}

/** Ниже этого порога классификатор не предлагает тип вообще — лучше честно
 * попросить пользователя выбрать вручную, чем угадать неправильно. */
const MIN_CONFIDENCE_TO_SUGGEST = 0.55;

const RULES: ClassifierRule[] = [
  {
    entityType: 'passport_rf',
    keywords: ['паспорт', 'российская федерация'],
    strongKeywords: ['паспорт гражданина российской федерации', 'код подразделения'],
    suppressedByStrongMatchOf: [
      'employment_contract',
      'service_contract',
      'lease_contract',
      'sale_contract',
      'loan_contract',
      'power_of_attorney',
      'application',
    ],
  },
  {
    entityType: 'snils',
    keywords: ['снилс', 'страховое свидетельство'],
    strongKeywords: [
      'страховой номер индивидуального лицевого счёта',
      'уведомление о регистрации в системе индивидуального',
    ],
  },
  {
    entityType: 'inn',
    keywords: ['инн', 'идентификационный номер налогоплательщика'],
    strongKeywords: ['свидетельство о постановке на учёт в налоговом органе', 'форма № 2-1-учёт'],
  },
  {
    entityType: 'foreign_passport',
    keywords: ['загранпаспорт', 'passport', 'загран'],
    strongKeywords: ['паспорт для выезда из российской федерации'],
  },
  {
    entityType: 'driver_license',
    keywords: ['водительское удостоверение', 'категории'],
    strongKeywords: ['водительское удостоверение', 'подразделение гибдд'],
  },
  {
    entityType: 'birth_certificate',
    keywords: ['свидетельство о рождении', 'запись акта о рождении'],
    strongKeywords: ['свидетельство о рождении', 'орган загс'],
  },
  {
    entityType: 'marriage_certificate',
    keywords: ['свидетельство о браке', 'заключении брака'],
    strongKeywords: ['свидетельство о заключении брака'],
  },
  {
    entityType: 'residence_permit',
    keywords: ['внж', 'вид на жительство'],
    strongKeywords: ['разрешение на постоянное проживание'],
  },
  {
    entityType: 'employment_contract',
    keywords: ['работодатель', 'работник', 'должностной оклад'],
    strongKeywords: ['трудовой договор', 'трудового договора'],
  },
  {
    entityType: 'service_contract',
    keywords: ['исполнитель', 'заказчик', 'оказание услуг'],
    strongKeywords: ['договор оказания услуг', 'договор возмездного оказания услуг'],
  },
  {
    entityType: 'lease_contract',
    keywords: ['арендодатель', 'арендатор', 'арендная плата'],
    strongKeywords: ['договор аренды', 'договор найма жилого помещения'],
  },
  {
    entityType: 'sale_contract',
    keywords: ['продавец', 'покупатель', 'товар'],
    strongKeywords: ['договор купли-продажи'],
  },
  {
    entityType: 'loan_contract',
    keywords: ['заём', 'займодавец', 'проценты'],
    strongKeywords: ['договор займа', 'договор денежного займа'],
  },
  {
    entityType: 'act_of_work',
    keywords: ['выполненных работ', 'оказанных услуг', 'претензий не имеет'],
    strongKeywords: ['акт выполненных работ', 'акт оказанных услуг', 'акт приёма-передачи'],
  },
  {
    entityType: 'invoice',
    keywords: ['к оплате', 'реквизиты', 'банк получателя'],
    strongKeywords: ['счёт на оплату', 'счёт №'],
  },
  {
    entityType: 'invoice_facture',
    keywords: ['грузоотправитель', 'грузополучатель', 'ставка ндс'],
    strongKeywords: ['счёт-фактура'],
  },
  {
    entityType: 'application',
    keywords: ['прошу', 'заявление'],
    strongKeywords: ['заявление о', 'заявление на'],
  },
  {
    entityType: 'power_of_attorney',
    keywords: ['уполномочивает', 'полномочия', 'настоящей доверенности'],
    strongKeywords: ['доверенность', 'доверяю'],
  },
  {
    entityType: 'certificate',
    keywords: ['выдана для предъявления', 'настоящая справка'],
    strongKeywords: ['справка выдана', 'настоящая справка выдана'],
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

  // Сначала находим, у каких типов есть сильное (высокоуверенное) совпадение —
  // это нужно, чтобы подавить конкурирующие слабые совпадения других типов.
  const strongTypesFound = new Set<string>();
  for (const rule of RULES) {
    const hasStrong = (rule.strongKeywords ?? []).some((k) => normalized.includes(k));
    if (hasStrong) strongTypesFound.add(rule.entityType);
  }

  let best: ClassificationResult | null = null;

  for (const rule of RULES) {
    const isSuppressed = (rule.suppressedByStrongMatchOf ?? []).some((t) => strongTypesFound.has(t));
    if (isSuppressed) continue; // например: "паспорт" упомянут внутри трудового договора — не считаем паспортом

    const matched = rule.keywords.filter((k) => normalized.includes(k));
    if (matched.length === 0) continue;

    const strongMatched = (rule.strongKeywords ?? []).filter((k) => normalized.includes(k));
    const confidence = strongMatched.length > 0 ? 0.85 : Math.min(0.3 + matched.length * 0.15, 0.6);

    if (!best || confidence > best.confidence) {
      best = { entityType: rule.entityType, confidence, matchedKeywords: [...matched, ...strongMatched] };
    }
  }

  // Не угадываем при низкой уверенности — честнее попросить пользователя выбрать тип самому.
  if (best && best.confidence < MIN_CONFIDENCE_TO_SUGGEST) {
    return null;
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
