import { findReconciliationCandidates } from '../reconciliation';

describe('findReconciliationCandidates — сверка квитанции ЖКХ с банковскими операциями', () => {
  const transactions = [
    { id: 't1', date: '2026-06-24', amount: -1593.28 }, // ровно сумма июньского счёта Мосэнергосбыта
    { id: 't2', date: '2026-07-10', amount: -30010 },
    { id: 't3', date: '2026-08-11', amount: -5000 },
    { id: 't4', date: '2026-06-20', amount: -4451.06 }, // сумма квитанции УК
  ];

  it('находит операцию с точно совпадающей суммой (счёт Мосэнергосбыта, 1593.28)', () => {
    const candidates = findReconciliationCandidates(1593.28, '2026-06-15', transactions);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].transactionId).toBe('t1');
    expect(candidates[0].amountMatchType).toBe('exact');
  });

  it('находит операцию с точно совпадающей суммой (квитанция УК, 4451.06)', () => {
    const candidates = findReconciliationCandidates(4451.06, '2026-06-05', transactions);
    expect(candidates[0].transactionId).toBe('t4');
  });

  it('не предлагает операции вне допустимого окна дат, даже при совпадении суммы', () => {
    const candidates = findReconciliationCandidates(1593.28, '2026-01-01', transactions, { maxDaysDifference: 20 });
    expect(candidates.find((c) => c.transactionId === 't1')).toBeUndefined();
  });

  it('не предлагает операции с несовпадающей суммой', () => {
    const candidates = findReconciliationCandidates(999.99, '2026-06-24', transactions);
    expect(candidates).toEqual([]);
  });

  it('сортирует кандидатов по уверенности (ближе по дате — выше)', () => {
    const txs = [
      { id: 'far', date: '2026-06-01', amount: -1000 },
      { id: 'close', date: '2026-06-14', amount: -1000 },
    ];
    const candidates = findReconciliationCandidates(1000, '2026-06-15', txs, { maxDaysDifference: 20 });
    expect(candidates[0].transactionId).toBe('close');
  });
});
