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

  it('слабое совпадение даёт низкую уверенность', () => {
    const text = 'где-то упоминается паспорт мельком в письме';
    const result = classifyDocumentText(text);
    expect(result?.entityType).toBe('passport_rf');
    expect(result?.confidence).toBeLessThan(0.7);
  });

  it('извлекает серию и номер паспорта из текста', () => {
    const attrs = extractSuggestedAttributes('passport_rf', 'ПАСПОРТ 45 00 123456 выдан 20.05.2015');
    expect(attrs.series).toBe('45 00');
    expect(attrs.number).toBe('123456');
    expect(attrs.issueDate).toBe('2015-05-20');
  });

  it('извлекает номер СНИЛС в правильном формате', () => {
    const attrs = extractSuggestedAttributes('snils', 'СНИЛС 123-456-789 00');
    expect(attrs.number).toBe('123-456-789 00');
  });

  it('извлекает ИНН (10 или 12 цифр)', () => {
    const attrs = extractSuggestedAttributes('inn', 'ИНН 7712345678');
    expect(attrs.number).toBe('7712345678');
  });

  it('для незнакомого типа не пытается ничего извлечь', () => {
    const attrs = extractSuggestedAttributes('vehicle', 'ПТС AA123456 VIN XTA212345X1234567');
    expect(attrs).toEqual({});
  });
});
