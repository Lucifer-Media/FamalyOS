import { classifyDocumentText, extractSuggestedAttributes, applyOcrQualityToClassification, tokenReadabilityRatio } from '../document-classifier';

describe('Эвристический классификатор документов (Итерация 2)', () => {
  it('распознаёт паспорт РФ по сильным ключевым словам с высокой уверенностью', () => {
    const text = 'ПАСПОРТ ГРАЖДАНИНА РОССИЙСКОЙ ФЕДЕРАЦИИ\nКОД ПОДРАЗДЕЛЕНИЯ 770-001';
    const result = classifyDocumentText(text);
    expect(result?.entityType).toBe('passport_rf');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('распознаёт СНИЛС', () => {
    const text = 'СТРАХОВОЕ СВИДЕТЕЛЬСТВО\nСТРАХОВОЙ НОМЕР ИНДИВИДУАЛЬНОГО ЛИЦЕВОГО СЧЁТА';
    const result = classifyDocumentText(text);
    expect(result?.entityType).toBe('snils');
  });

  it('при отсутствии совпадений возвращает null (не угадывает наугад)', () => {
    const result = classifyDocumentText('Случайный текст без ключевых слов документа вообще');
    expect(result).toBeNull();
  });

  it('слабое совпадение (ниже порога уверенности) не предлагается вообще — лучше честно спросить пользователя', () => {
    const result = classifyDocumentText('где-то упоминается паспорт мельком в письме');
    expect(result).toBeNull();
  });

  it('РЕГРЕССИЯ: трудовой договор с реквизитами паспорта работника не путается с паспортом', () => {
    const text = `
      ТРУДОВОЙ ДОГОВОР № 12
      Работодатель ООО «Тест» и Работник заключили настоящий трудовой договор.
      Паспорт серия 45 00 номер 123456, кем выдан ОВД района Тестовый.
      Должностной оклад составляет 100 000 рублей.
    `;
    const result = classifyDocumentText(text);
    expect(result?.entityType).toBe('employment_contract');
    expect(result?.entityType).not.toBe('passport_rf');
  });

  it('договор аренды не путается с договором купли-продажи', () => {
    const text = 'ДОГОВОР АРЕНДЫ жилого помещения. Арендодатель передаёт, Арендатор принимает. Арендная плата 50000 руб.';
    const result = classifyDocumentText(text);
    expect(result?.entityType).toBe('lease_contract');
  });

  it('извлекает серию и номер паспорта из текста, с полем уверенности по каждому значению', () => {
    const { attributes, fieldConfidence } = extractSuggestedAttributes(
      'passport_rf',
      'ПАСПОРТ 45 00 123456 выдан 20.05.2015',
    );
    expect(attributes.series).toBe('45 00');
    expect(attributes.number).toBe('123456');
    expect(attributes.issueDate).toBe('2015-05-20');
    expect(fieldConfidence.number).toBeGreaterThan(0);
    expect(fieldConfidence.series).toBeGreaterThan(0);
  });

  it('извлекает номер СНИЛС только при верной контрольной сумме (защита от ошибок OCR)', () => {
    // 112-233-445 95 — валидная контрольная сумма по алгоритму СФР
    const valid = extractSuggestedAttributes('snils', 'СНИЛС 112-233-445 95');
    expect(valid.attributes.number).toBe('112-233-445 95');
    expect(valid.fieldConfidence.number).toBeGreaterThanOrEqual(0.9); // контрольная сумма сошлась — высокая уверенность

    // 123-456-789 00 — синтаксически похоже на СНИЛС, но контрольная сумма неверна
    const invalid = extractSuggestedAttributes('snils', 'СНИЛС 123-456-789 00');
    expect(invalid.attributes.number).toBeUndefined();
  });

  it('извлекает ИНН (10 или 12 цифр)', () => {
    const { attributes } = extractSuggestedAttributes('inn', 'ИНН 7712345678');
    expect(attributes.number).toBe('7712345678');
  });

  it('для незнакомого типа не пытается ничего извлечь', () => {
    const { attributes } = extractSuggestedAttributes('vehicle', 'ПТС AA123456 VIN XTA212345X1234567');
    expect(attributes).toEqual({});
  });

  it('загранпаспорт: при наличии MRZ использует её с высокой уверенностью, а не текст разворота', () => {
    const mrzLine1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<';
    const mrzLine2 = 'L898902C<3UTO6908061F9406236ZE184226B<<<<<10';
    const { attributes, fieldConfidence } = extractSuggestedAttributes(
      'foreign_passport',
      `какой-то шум OCR\n${mrzLine1}\n${mrzLine2}`,
    );
    expect(attributes.fullName).toBe('ERIKSSON ANNA MARIA');
    expect(attributes.number).toBe('L898902C');
    expect(fieldConfidence.number).toBeGreaterThanOrEqual(0.9);
  });

  it('кассовый чек: извлекает список товаров и итоговую сумму', () => {
    const text = 'Хлеб белый 1 x 45.00 = 45.00\nИТОГО 45.00';
    const { attributes } = extractSuggestedAttributes('cash_receipt', text);
    expect(attributes.totalAmount).toBe(45);
    expect(String(attributes.items)).toContain('Хлеб');
  });
});

describe('applyOcrQualityToClassification — коррекция уверенности по качеству OCR (регрессия)', () => {
  it('РЕГРЕССИЯ: чисто мусорный текст с шумом подавляет случайное совпадение ключевой фразы', () => {
    // Настоящий, а не синтетический пример — это буквально вывод OCR с одного
    // из первых скриншотов пользователя (полностью нечитаемый скан), где
    // тем не менее случайно проступает "РОССИЙСКАЯ ФЕДЕРАЦИЯ".
    const realGarbageText =
      '} | ] ee oo в о к о о E = PW ee 1 d ) O f o ты еае м, ee и ed if - a ME RON AN I I LR SN am ' +
      'RON RN TE oN ee 8 WAMU ANT) Be A AAC И К | eh Aaa и м И. И > и РОССИЙСКАЯ ФЕДЕРАЦИЯ На !';
    expect(tokenReadabilityRatio(realGarbageText)).toBeLessThan(0.15); // подтверждаем: это действительно шум

    const raw = classifyDocumentText(realGarbageText);
    const adjusted = applyOcrQualityToClassification(raw, realGarbageText, 0.4);
    expect(adjusted).toBeNull(); // текст-шум — не предлагаем тип вообще, даже если фраза совпала
  });

  it('РЕГРЕССИЯ: реальный (пусть и небезупречный) OCR-текст настоящего документа НЕ подавляется, даже при умеренной уверенности движка', () => {
    // Полный текст, реально полученный агентом при прогоне OCR на
    // предоставленном пользователем скане свидетельства о браке — уверенность
    // Tesseract была ~50%, но заголовок распознан чисто и однозначно.
    const realWorldText =
      'С СВИДЕТЕЛЬСТВО 6 | eh О ЗАКЛЮЧЕНИИ БРАКА "i | У < Ne, | NA ool | ' +
      'ны $e | » <. со" | a < SY YYI] +. мы | $ © | гро @ 29 07 т оо $ В | ' +
      'GB ФФФё so Bur ть BOW OTIS 14 18 PION В WEBS 6014 о MB IOWESS spose | | ° г. | * save о@-д';
    expect(tokenReadabilityRatio(realWorldText)).toBeGreaterThanOrEqual(0.15); // не чистый шум

    const raw = classifyDocumentText(realWorldText);
    const adjusted = applyOcrQualityToClassification(raw, realWorldText, 0.5);
    expect(adjusted).not.toBeNull();
  });

  it('embedded_pdf_text (ocrConfidence=null) не корректируется — текстовому слою PDF доверяем как есть', () => {
    const raw = classifyDocumentText('ПАСПОРТ ГРАЖДАНИНА РОССИЙСКОЙ ФЕДЕРАЦИИ');
    const adjusted = applyOcrQualityToClassification(raw, 'ПАСПОРТ ГРАЖДАНИНА РОССИЙСКОЙ ФЕДЕРАЦИИ', null);
    expect(adjusted).toEqual(raw);
  });
});

describe('Квитанции ЖКХ — реальные форматы (УК, Мосэнергосбыт, Мосводоканал)', () => {
  it('РЕГРЕССИЯ: сильное совпадение классифицирует документ, даже если ни одно слабое ключевое слово не встретилось', () => {
    // Баг: "СЧЁТ ЗА ЭЛЕКТРОЭНЕРГИЮ" — точная сильная фраза, но ни одно из
    // слабых ключевых слов правила ('коммунальных услуг', 'лицевой счёт' и
    // т.д.) в этом конкретном бланке не встречается — раньше это приводило
    // к тому, что правило пропускалось целиком.
    const mosenergoHeader = 'СЧЁТ ЗА ЭЛЕКТРОЭНЕРГИЮ / июнь 2026 г.';
    const result = classifyDocumentText(mosenergoHeader);
    expect(result?.entityType).toBe('utility_bill');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('извлекает итоговую сумму и период из квитанции управляющей компании', () => {
    const text = 'ПЛАТЕЖНЫЙ ДОКУМЕНТ коммунальных услуг за Июнь 2026 г.\nИтого к оплате, руб. 4 451,06';
    const { attributes } = extractSuggestedAttributes('utility_bill', text);
    expect(attributes.totalAmount).toBe(4451.06);
    expect(attributes.period).toBe('2026-06');
  });

  it('извлекает итоговую сумму из счёта Мосэнергосбыта (формат без запятой после "ИТОГО")', () => {
    const text = 'СЧЁТ ЗА ЭЛЕКТРОЭНЕРГИЮ / июнь 2026 г.\nИТОГО К ОПЛАТЕ: 1593,28';
    const { attributes } = extractSuggestedAttributes('utility_bill', text);
    expect(attributes.totalAmount).toBe(1593.28);
  });

  it('извлекает срок оплаты из платёжного документа Мосводоканала', () => {
    const text = 'Итого к оплате 529.88 руб.\nСрок оплаты до 15.09.2026 г.';
    const { attributes } = extractSuggestedAttributes('utility_bill', text);
    expect(attributes.totalAmount).toBe(529.88);
    expect(attributes.dueDate).toBe('2026-09-15');
  });
});

describe('Извлечение расшифровки показаний счётчиков из квитанции ЖКХ', () => {
  it('захватывает строки с показаниями по разным аббревиатурам ресурсов (реальный формат УК)', () => {
    const text = [
      'ПОКАЗАНИЯ ИПУ',
      'ГОРЯЧЕЕ В/С 1345356 34,880000',
      'ГОРЯЧЕЕ В/С 1345360 96,410000',
      'Итого к оплате, руб. 4 451,06',
      'Электроэнергия ОДН кВт 0,00 15,675050',
    ].join('\n');
    const { attributes } = extractSuggestedAttributes('utility_bill', text);
    expect(String(attributes.breakdown)).toContain('ГОРЯЧЕЕ В/С 1345356');
    expect(String(attributes.breakdown)).toContain('Электроэнергия ОДН');
    // Строка про сумму к оплате — не показание счётчика, не должна попасть в расшифровку.
    expect(String(attributes.breakdown)).not.toContain('Итого к оплате');
  });

  it('для документа без строк показаний breakdown не заполняется', () => {
    const { attributes } = extractSuggestedAttributes('utility_bill', 'Итого к оплате, руб. 100,00');
    expect(attributes.breakdown).toBeUndefined();
  });
});
