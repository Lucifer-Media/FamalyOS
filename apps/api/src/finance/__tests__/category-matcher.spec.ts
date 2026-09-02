import { matchCategoryByName } from '../category-matcher';

describe('matchCategoryByName', () => {
  const categories = [
    { id: 'c1', name: 'Продукты' },
    { id: 'c2', name: 'Транспорт' },
    { id: 'c3', name: 'ЖКХ' },
  ];

  it('находит точное совпадение без учёта регистра', () => {
    expect(matchCategoryByName('продукты', categories)).toBe('c1');
    expect(matchCategoryByName('ТРАНСПОРТ', categories)).toBe('c2');
  });

  it('игнорирует пробелы по краям', () => {
    expect(matchCategoryByName('  ЖКХ  ', categories)).toBe('c3');
  });

  it('не находит частичное/нечёткое совпадение — консервативно', () => {
    expect(matchCategoryByName('Продукты и товары', categories)).toBeUndefined();
    expect(matchCategoryByName('Прод', categories)).toBeUndefined();
  });

  it('возвращает undefined для пустого/отсутствующего текста', () => {
    expect(matchCategoryByName(undefined, categories)).toBeUndefined();
    expect(matchCategoryByName('', categories)).toBeUndefined();
    expect(matchCategoryByName('   ', categories)).toBeUndefined();
  });

  it('возвращает undefined, если справочник пуст', () => {
    expect(matchCategoryByName('Продукты', [])).toBeUndefined();
  });
});
