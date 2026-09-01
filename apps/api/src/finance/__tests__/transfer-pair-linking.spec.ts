import { findTransferPairMatch } from '../reconciliation';

describe('findTransferPairMatch — сопоставление пар переводов между своими счетами', () => {
  it('РЕГРЕССИЯ: находит операцию с противоположной суммой в другом счёте, близкую по дате', () => {
    const match = findTransferPairMatch(
      'account-1',
      { id: 'a', date: '2026-08-24', amount: 5000 },
      [
        { id: 'b', attributes: { accountId: 'account-2', amount: -5000, date: '2026-08-23' } },
        { id: 'c', attributes: { accountId: 'account-3', amount: -100, date: '2026-08-23' } }, // не совпадает по сумме
      ],
    );
    expect(match).toBe('b');
  });

  it('не связывает операции в пределах ОДНОГО И ТОГО ЖЕ счёта', () => {
    const match = findTransferPairMatch(
      'account-1',
      { id: 'a', date: '2026-08-24', amount: 5000 },
      [{ id: 'b', attributes: { accountId: 'account-1', amount: -5000, date: '2026-08-24' } }],
    );
    expect(match).toBeUndefined();
  });

  it('не связывает, если разница дат больше 3 суток', () => {
    const match = findTransferPairMatch(
      'account-1',
      { id: 'a', date: '2026-08-24', amount: 5000 },
      [{ id: 'b', attributes: { accountId: 'account-2', amount: -5000, date: '2026-08-01' } }],
    );
    expect(match).toBeUndefined();
  });

  it('не трогает операцию, уже связанную с чем-то другим', () => {
    const match = findTransferPairMatch(
      'account-1',
      { id: 'a', date: '2026-08-24', amount: 5000 },
      [{ id: 'b', attributes: { accountId: 'account-2', amount: -5000, date: '2026-08-24', relatedTransactionId: 'x' } }],
    );
    expect(match).toBeUndefined();
  });

  it('реальные суммы из выписки Альфа-банка — "Между своими счетами" +1000/-1000', () => {
    const match = findTransferPairMatch(
      'account-alfa',
      { id: 'a', date: '2026-08-24', amount: 1000 },
      [{ id: 'b', attributes: { accountId: 'account-other', amount: -1000, date: '2026-08-24' } }],
    );
    expect(match).toBe('b');
  });
});
