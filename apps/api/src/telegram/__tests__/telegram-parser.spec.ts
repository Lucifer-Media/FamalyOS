import { parseEntries, parseEntryLine, guessCategoryByKeywords, budgetAlertLevel, localToday, markdownToTelegramHtml, parseAllowedChatIds } from '../telegram-parser';

const T = '2026-11-07';

describe('Разбор быстрой записи', () => {
  it.each([
    ['350 кофе', -350, 'кофе', T],
    ['кофе 350р', -350, 'кофе', T],
    ['1 200,50 продукты', -1200.5, 'продукты', T],
    ['такси 800 вчера', -800, 'такси', '2026-11-06'],
    ['05.11 аптека 1200', -1200, 'аптека', '2026-11-05'],
    ['1.5к стоматолог', -1500, 'стоматолог', T],
    ['+50000 зарплата', 50000, 'зарплата', T],
    ['доход 3000 кешбэк', 3000, 'доход кешбэк', T],
    ['Пятёрочка 2 340 ₽', -2340, 'Пятёрочка', T],
  ])('%s', (text, amount, description, date) => {
    expect(parseEntryLine(text, T)).toMatchObject({ amount, description, date });
  });

  it('личное/общее — отдельный признак, не часть описания', () => {
    expect(parseEntryLine('кино 900 личное', T)).toMatchObject({ amount: -900, description: 'кино', scope: 'PERSONAL' });
    expect(parseEntryLine('отпуск билеты 45000 общее', T)).toMatchObject({ scope: 'FAMILY', description: 'отпуск билеты' });
  });

  it('дата без года в будущем — прошлый год', () => {
    expect(parseEntryLine('28.12 ёлка 3000', '2026-01-05')!.date).toBe('2025-12-28');
  });

  it('несколько строк — несколько операций; строки без суммы пропускаются', () => {
    const r = parseEntries('кофе 300\nпривет\nтакси 700', T)!;
    expect(r.map((e) => e.amount)).toEqual([-300, -700]);
    expect(parseEntries('как дела?', T)).toBeNull();
  });
});

describe('Подсказка категории по словам', () => {
  const cats = [
    { id: 'food', name: 'Продукты' },
    { id: 'cafe', name: 'Кафе и рестораны' },
    { id: 'med', name: 'Медицина' },
    { id: 'tr', name: 'Транспорт' },
  ];
  it.each([
    ['Пятёрочка', 'food'],
    ['кофе с собой', 'cafe'],
    ['стоматолог', 'med'],
    ['аптека', 'med'],
    ['такси домой', 'tr'],
    ['продукты на неделю', 'food'],
  ])('%s → %s', (d, id) => expect(guessCategoryByKeywords(d, cats)).toBe(id));

  it('нет подходящей категории — undefined, а не угадывание', () => {
    expect(guessCategoryByKeywords('непонятная покупка', cats)).toBeUndefined();
    expect(guessCategoryByKeywords('бензин', cats)).toBe('tr');
  });
});

describe('Пороги бюджета', () => {
  it('80% по умолчанию, свой порог, превышение', () => {
    expect(budgetAlertLevel(50, null)).toBe(0);
    expect(budgetAlertLevel(81, null)).toBe(80);
    expect(budgetAlertLevel(91, 90)).toBe(90);
    expect(budgetAlertLevel(120, 90)).toBe(100);
    expect(budgetAlertLevel(null, 80)).toBe(0);
  });
});

describe('Служебное', () => {
  it('«сегодня» по Москве, а не по UTC', () => {
    expect(localToday('Europe/Moscow', new Date('2026-11-06T22:30:00Z'))).toBe('2026-11-07');
  });
  it('Markdown → Telegram HTML с экранированием', () => {
    expect(markdownToTelegramHtml('## Итог\n- **5 000 ₽** <x>')).toBe('<b>Итог</b>\n• <b>5 000 ₽</b> &lt;x&gt;');
  });
  it('белый список чатов', () => {
    expect([...parseAllowedChatIds('-5373163824, 429043619 abc')]).toEqual(['-5373163824', '429043619']);
  });
});
