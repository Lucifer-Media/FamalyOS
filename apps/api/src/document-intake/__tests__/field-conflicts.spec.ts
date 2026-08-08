import { computeFieldConflicts } from '../field-conflicts';

describe('computeFieldConflicts — защита от молчаливой перезаписи подтверждённых данных', () => {
  it('не считает конфликтом поле, которое ещё не было заполнено', () => {
    const conflicts = computeFieldConflicts({ series: undefined }, { series: '45 18' }, { series: 0.7 });
    expect(conflicts).toEqual([]);
  });

  it('находит конфликт, когда предложенное значение отличается от уже сохранённого', () => {
    const conflicts = computeFieldConflicts(
      { series: '45 00', number: '123456' },
      { series: '45 18', number: '123456' }, // OCR ошибочно распознал другую серию
      { series: 0.6 },
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      field: 'series',
      currentValue: '45 00',
      suggestedValue: '45 18',
      suggestedConfidence: 0.6,
    });
  });

  it('не считает конфликтом совпадающие значения', () => {
    const conflicts = computeFieldConflicts({ number: '123456' }, { number: '123456' });
    expect(conflicts).toEqual([]);
  });

  it('пустая строка в текущем значении не блокирует предложенное (считается незаполненным)', () => {
    const conflicts = computeFieldConflicts({ notes: '' }, { notes: 'что-то' });
    expect(conflicts).toEqual([]);
  });
});
