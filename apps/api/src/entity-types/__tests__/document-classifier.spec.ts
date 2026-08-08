import { classifyDocumentText, extractSuggestedAttributes } from '../document-classifier';

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
