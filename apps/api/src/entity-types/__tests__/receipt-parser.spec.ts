import { extractReceiptItems, formatReceiptItemsAsText } from '../receipt-parser';

describe('Извлечение позиций кассового чека (без ФНС, только OCR-эвристика)', () => {
  const sampleReceipt = `
ООО Магазин Тест
Хлеб белый          1 x  45.00 =   45.00
Молоко 1л           2 x  89.90 =  179.80
ИТОГО                              224.80
НАЛИЧНЫМИ                          300.00
СДАЧА                               75.20
ИНН 7712345678
ФН 1234567890123456
`;

  it('извлекает позиции с количеством, ценой и суммой', () => {
    const result = extractReceiptItems(sampleReceipt);
    expect(result.items.length).toBeGreaterThanOrEqual(2);

    const bread = result.items.find((i) => i.name.includes('Хлеб'));
    expect(bread?.amount).toBe(45.0);
    expect(bread?.quantity).toBe(1);
    expect(bread?.price).toBe(45.0);

    const milk = result.items.find((i) => i.name.includes('Молоко'));
    expect(milk?.amount).toBe(179.8);
    expect(milk?.quantity).toBe(2);
  });

  it('извлекает итоговую сумму отдельно от позиций', () => {
    const result = extractReceiptItems(sampleReceipt);
    expect(result.totalAmount).toBe(224.8);
  });

  it('служебные строки (ИНН, ФН, наличными, сдача) не попадают в список товаров', () => {
    const result = extractReceiptItems(sampleReceipt);
    const names = result.items.map((i) => i.name.toLowerCase());
    expect(names.some((n) => n.includes('инн'))).toBe(false);
    expect(names.some((n) => n.includes('наличными'))).toBe(false);
    expect(names.some((n) => n.includes('сдача'))).toBe(false);
  });

  it('форматирует позиции в читаемый текст для поля items', () => {
    const result = extractReceiptItems(sampleReceipt);
    const text = formatReceiptItemsAsText(result.items);
    expect(text).toContain('Хлеб');
    expect(text.split('\n').length).toBe(result.items.length);
  });

  it('пустой/нерелевантный текст не создаёт ложных позиций', () => {
    const result = extractReceiptItems('Случайный текст без структуры чека');
    expect(result.items).toEqual([]);
  });
});
