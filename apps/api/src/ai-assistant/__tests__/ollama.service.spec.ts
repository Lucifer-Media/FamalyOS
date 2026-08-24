import { buildExtractionPrompt, parseExtractionResponse } from '../ollama.service';
import { FieldSchema } from '../../entity-types/field-schema.types';

const FIELDS: FieldSchema[] = [
  { key: 'period', label: 'Период', type: 'string' },
  { key: 'totalAmount', label: 'Итого к оплате', type: 'number' },
  { key: 'propertyId', label: 'Объект недвижимости', type: 'link', linkTarget: 'real_estate' },
];

describe('buildExtractionPrompt', () => {
  it('не включает поля типа link — LLM не может надёжно подобрать id связанной сущности по тексту', () => {
    const prompt = buildExtractionPrompt('utility_bill', FIELDS, 'какой-то текст');
    expect(prompt).toContain('period');
    expect(prompt).toContain('totalAmount');
    expect(prompt).not.toContain('propertyId');
  });

  it('явно требует не выдумывать значения и не превышать длину текста', () => {
    const longText = 'а'.repeat(10000);
    const prompt = buildExtractionPrompt('utility_bill', FIELDS, longText);
    expect(prompt).toContain('НЕ включай этот ключ');
    expect(prompt.length).toBeLessThan(longText.length); // текст обрезан
  });
});

describe('parseExtractionResponse', () => {
  it('извлекает только разрешённые поля, игнорируя лишние ключи от модели', () => {
    const raw = JSON.stringify({ period: '2026-06', totalAmount: 1593.28, unexpectedField: 'мусор' });
    const result = parseExtractionResponse(raw, FIELDS);
    expect(result.attributes).toEqual({ period: '2026-06', totalAmount: 1593.28 });
    expect(result.attributes.unexpectedField).toBeUndefined();
  });

  it('снимает обёртку ```json ... ``` , если модель её добавила несмотря на инструкцию', () => {
    const raw = '```json\n{"period": "2026-07"}\n```';
    const result = parseExtractionResponse(raw, FIELDS);
    expect(result.attributes.period).toBe('2026-07');
  });

  it('РЕГРЕССИЯ: не выдумывает поля, которых нет в ответе модели — пустые/null значения отбрасываются', () => {
    const raw = JSON.stringify({ period: '', totalAmount: null });
    const result = parseExtractionResponse(raw, FIELDS);
    expect(result.attributes).toEqual({});
  });

  it('на невалидный JSON возвращает пустой результат, не падает', () => {
    const result = parseExtractionResponse('это не JSON вообще', FIELDS);
    expect(result.attributes).toEqual({});
    expect(result.unavailable).toBe(false);
  });

  it('на JSON-массив (не объект) возвращает пустой результат', () => {
    const result = parseExtractionResponse('[1, 2, 3]', FIELDS);
    expect(result.attributes).toEqual({});
  });

  it('назначает всем извлечённым полям уверенность ниже уверенного regex-совпадения (0.55)', () => {
    const raw = JSON.stringify({ period: '2026-06' });
    const result = parseExtractionResponse(raw, FIELDS);
    expect(result.fieldConfidence.period).toBe(0.55);
  });
});
