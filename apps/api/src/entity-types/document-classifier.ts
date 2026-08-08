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

import { extractMrz } from './mrz-parser';
import { extractReceiptItems, formatReceiptItemsAsText } from './receipt-parser';

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
  {
    entityType: 'military_id',
    keywords: ['военный билет', 'военно-учётная', 'годен к военной службе'],
    strongKeywords: ['военный билет офицера запаса', 'военный билет солдата'],
  },
  {
    entityType: 'passport_registration',
    keywords: ['регистрация', 'место жительства'],
    strongKeywords: ['регистрация по месту жительства', 'место жительства зарегистрирован'],
  },
  {
    entityType: 'passport_marriage',
    keywords: ['брак', 'семейное положение'],
    strongKeywords: ['заключении брака', 'семейное положение'],
  },
  {
    entityType: 'passport_child_record',
    keywords: ['дети'],
    strongKeywords: ['сведения о детях', 'дети:'],
  },
  {
    entityType: 'cash_receipt',
    keywords: ['кассовый чек', 'фискальный признак', 'приход'],
    strongKeywords: ['кассовый чек', 'фн ', 'фд ', 'фп '],
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
const RE_SNILS = /(\d{3}[- ]?\d{3}[- ]?\d{3}[- ]?\d{2})/;
const RE_INN = /\b(\d{10}|\d{12})\b/;
const RE_DATE_RU = /(\d{2})\.(\d{2})\.(\d{4})/g; // ДД.ММ.ГГГГ — частый формат в бланках РФ

/** Все встреченные даты ДД.ММ.ГГГГ по порядку появления в тексте (для документов с несколькими датами). */
function findAllRuDates(text: string): string[] {
  const matches = [...text.matchAll(RE_DATE_RU)];
  return matches.map((m) => `${m[3]}-${m[2]}-${m[1]}`);
}

/** Контрольная сумма СНИЛС (алгоритм ПФР/СФР) — используется, чтобы не предлагать
 * заведомо неверно распознанный номер (частая ошибка OCR — спутанные цифры). */
function isValidSnilsChecksum(digits: string): boolean {
  if (digits.length !== 11) return false;
  const nums = digits.split('').map(Number);
  const account = nums.slice(0, 9);
  const checksum = nums[9] * 10 + nums[10];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += account[i] * (9 - i);
  let expected = sum % 101;
  if (expected === 100) expected = 0;
  return expected === checksum;
}

export interface FieldExtractionResult {
  attributes: Record<string, unknown>;
  /** Уверенность извлечения по каждому полю (0..1) — не то же самое, что
   * уверенность классификации типа документа в целом. */
  fieldConfidence: Record<string, number>;
}

export function extractSuggestedAttributes(
  entityType: string,
  text: string,
): FieldExtractionResult {
  const attrs: Record<string, unknown> = {};
  const fieldConfidence: Record<string, number> = {};
  const setField = (key: string, value: unknown, confidence: number) => {
    if (value === undefined || value === null || value === '') return;
    attrs[key] = value;
    fieldConfidence[key] = confidence;
  };
  const dates = findAllRuDates(text);

  if (entityType === 'passport_rf') {
    const seriesNumber = text.match(RE_PASSPORT_SERIES_NUMBER);
    if (seriesNumber) {
      setField('series', seriesNumber[1], 0.75);
      setField('number', seriesNumber[2], 0.8);
    }
    setField('issueDate', dates[0], 0.6); // самая ненадёжная эвристика — просто "первая дата в тексте"
  }

  if (entityType === 'snils') {
    const snils = text.match(RE_SNILS);
    if (snils) {
      const digitsOnly = snils[1].replace(/[- ]/g, '');
      // Предлагаем номер только если контрольная сумма сходится — иначе это,
      // скорее всего, ошибка OCR, и лучше вообще не предзаполнять поле,
      // чем подставить неверный номер.
      if (isValidSnilsChecksum(digitsOnly)) {
        setField('number', snils[1], 0.95); // контрольная сумма сошлась — высокая уверенность
      }
    }
    setField('issueDate', dates[0], 0.5);
  }

  if (entityType === 'inn') {
    const inn = text.match(RE_INN);
    if (inn) setField('number', inn[1], 0.7); // формат проверен только по длине, без контрольных цифр
    setField('issueDate', dates[0], 0.5);
  }

  if (entityType === 'foreign_passport') {
    // Приоритет источников: MRZ (машиночитаемая зона) намного надёжнее
    // произвольного текста разворота — если она нашлась и контрольные
    // цифры сошлись, используем именно её.
    const mrz = extractMrz(text);
    if (mrz) {
      const fullName = [mrz.surname, mrz.givenNames].filter(Boolean).join(' ');
      setField('fullName', fullName, mrz.documentNumberValid ? 0.95 : 0.7);
      setField('number', mrz.documentNumber, mrz.documentNumberValid ? 0.97 : 0.5);
      setField('birthDate', mrz.birthDateValid ? mrz.birthDate : undefined, 0.95);
      setField('expiryDate', mrz.expiryDateValid ? mrz.expiryDate : undefined, 0.95);
    } else {
      const seriesNumber = text.match(RE_PASSPORT_SERIES_NUMBER);
      if (seriesNumber) {
        setField('series', seriesNumber[1], 0.5);
        setField('number', seriesNumber[2], 0.55);
      }
      setField('issueDate', dates[0], 0.4);
      setField('expiryDate', dates[1], 0.4);
    }
  }

  if (entityType === 'driver_license') {
    setField('issueDate', dates[0], 0.55);
    setField('expiryDate', dates[1], 0.55);
    const categoriesMatch = text.match(/категор[а-я]*\s*[:\-]?\s*([A-DM1, ]{1,20})/i);
    if (categoriesMatch) setField('categories', categoriesMatch[1].trim(), 0.5);
  }

  if (entityType === 'birth_certificate' || entityType === 'marriage_certificate') {
    setField(entityType === 'birth_certificate' ? 'birthDate' : 'marriageDate', dates[0], 0.55);
  }

  if (entityType === 'cash_receipt') {
    const { items, totalAmount } = extractReceiptItems(text);
    if (totalAmount != null) setField('totalAmount', totalAmount, 0.7);
    if (items.length > 0) setField('items', formatReceiptItemsAsText(items), 0.55);
    const fnMatch = text.match(/фн\s*[:№]?\s*(\d{10,20})/i);
    if (fnMatch) setField('fiscalNumber', fnMatch[1], 0.6);
    const fdMatch = text.match(/фд\s*[:№]?\s*(\d{1,20})/i);
    if (fdMatch) setField('fiscalDocument', fdMatch[1], 0.6);
    const fpMatch = text.match(/фп\s*[:№]?\s*(\d{1,20})/i);
    if (fpMatch) setField('fiscalSign', fpMatch[1], 0.6);
    setField('date', dates[0], 0.5);
  }

  if (
    entityType === 'employment_contract' ||
    entityType === 'service_contract' ||
    entityType === 'lease_contract' ||
    entityType === 'sale_contract' ||
    entityType === 'loan_contract'
  ) {
    // Для договоров надёжно вытащить стороны/суммы простым regex нельзя —
    // формулировки слишком разнообразны (см. TECH_DEBT.md). Предзаполняем
    // только дату — самое надёжное поле для любого договора.
    setField('contractDate', dates[0], 0.5);
  }

  if (entityType === 'medical_visit' || entityType === 'medical_conclusion' || entityType === 'prescription') {
    setField('date', dates[0], 0.5);
    if (entityType === 'medical_conclusion') {
      const diagnosis = extractLabeledField(text, ['диагноз']);
      if (diagnosis) setField('diagnosis', diagnosis, 0.5);
    }
  }

  return { attributes: attrs, fieldConfidence };
}

export interface MedicalPartyGuesses {
  patientFullName?: string;
  doctorFullName?: string;
  organizationName?: string;
}

/**
 * Догадки об участниках медицинского документа (пациент/врач/организация) —
 * НЕ помещаются в attributes самой записи (их нет в схеме формы), а
 * используются ТОЛЬКО для попытки автоматически связать подтверждённую
 * запись с уже существующими карточками врача/организации в пространстве
 * (см. DocumentIntakeService.confirm). Это разбор подписанных полей бланка
 * ("Врач: Иванов И.И."), а не NLP/распознавание сущностей в свободном тексте.
 */
export function extractMedicalPartyGuesses(entityType: string, text: string): MedicalPartyGuesses {
  if (!['medical_visit', 'medical_conclusion', 'prescription', 'vaccination'].includes(entityType)) {
    return {};
  }
  return {
    patientFullName: extractLabeledField(text, ['пациент', 'больной', 'ф\\.?и\\.?о\\.? пациента']),
    doctorFullName: extractLabeledField(text, ['врач', 'лечащий врач', 'специалист']),
    organizationName: extractLabeledField(text, ['учреждение', 'организация', 'клиника', 'мед\\.? организация']),
  };
}

/**
 * Ищет в тексте строку вида "Метка: значение" (или "Метка — значение") по
 * списку возможных меток (регистронезависимо) и возвращает текст до конца
 * строки. Это НЕ NLP — просто разбор подписанных полей, характерных для
 * бланков (мед. документы, справки). Настоящее распознавание сущностей в
 * свободном тексте (без явной метки) требует модели — см. TECH_DEBT.md.
 */
function extractLabeledField(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-—]\\s*(.+)`, 'i');
    const match = text.match(re);
    if (match) {
      const value = match[1].trim().split('\n')[0].trim();
      if (value.length > 1 && value.length < 200) return value;
    }
  }
  return undefined;
}

/**
 * Пытается найти существующую сущность (врач/мед.организация/лекарство) с
 * похожим названием в пространстве и, если найдена, вернуть её id — чтобы
 * при подтверждении документа можно было предложить пользователю готовую
 * связь, а не создавать дубль. Сравнение — точное совпадение без учёта
 * регистра ИЛИ вхождение одной строки в другую (не NLP, не fuzzy-similarity).
 */
export function findBestNameMatch(
  candidateName: string | undefined,
  existingEntities: { id: string; title: string }[],
): string | undefined {
  if (!candidateName) return undefined;
  const normalized = candidateName.trim().toLowerCase();
  if (normalized.length < 3) return undefined;

  const exact = existingEntities.find((e) => e.title.trim().toLowerCase() === normalized);
  if (exact) return exact.id;

  const partial = existingEntities.find(
    (e) =>
      e.title.trim().toLowerCase().includes(normalized) || normalized.includes(e.title.trim().toLowerCase()),
  );
  return partial?.id;
}
