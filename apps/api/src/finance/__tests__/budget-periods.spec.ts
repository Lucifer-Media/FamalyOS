import {
  periodKeyForDate,
  labelForPeriodKey,
  computePeriodBreakdown,
  sanitizePeriodAllocations,
} from '../budget-periods';

describe('budget-periods', () => {
  describe('periodKeyForDate', () => {
    it('returns the year for YEARLY', () => {
      expect(periodKeyForDate('2026-09-15', 'YEARLY')).toBe('2026');
    });
    it('returns YYYY-MM for MONTHLY', () => {
      expect(periodKeyForDate('2026-09-15', 'MONTHLY')).toBe('2026-09');
      expect(periodKeyForDate('2026-01-01', 'MONTHLY')).toBe('2026-01');
    });
    it('returns ISO week for WEEKLY', () => {
      // 2026-09-01 — вторник, 36-я неделя ISO 2026
      expect(periodKeyForDate('2026-09-01', 'WEEKLY')).toBe('2026-W36');
    });
    it('returns empty string for invalid date', () => {
      expect(periodKeyForDate('', 'MONTHLY')).toBe('');
      expect(periodKeyForDate('not-a-date', 'MONTHLY')).toBe('');
    });
  });

  describe('labelForPeriodKey', () => {
    it('formats monthly label in Russian', () => {
      expect(labelForPeriodKey('2026-09', 'MONTHLY')).toBe('сен 2026');
    });
    it('formats yearly label as-is', () => {
      expect(labelForPeriodKey('2026', 'YEARLY')).toBe('2026');
    });
    it('formats weekly label', () => {
      expect(labelForPeriodKey('2026-W36', 'WEEKLY')).toBe('нед. 36, 2026');
    });
  });

  describe('computePeriodBreakdown', () => {
    it('aggregates spend per period and computes remaining/percent', () => {
      const allocations = [
        { period: '2026-09', plannedAmount: 1000 },
        { period: '2026-10', plannedAmount: 2000 },
      ];
      const transactions = [
        { date: '2026-09-05', amount: -300 },
        { date: '2026-09-20', amount: -400 },
        { date: '2026-10-01', amount: -2500 }, // over budget
        { date: '2026-09-10', amount: 500 }, // income — ignored
      ];
      const result = computePeriodBreakdown(allocations, 'MONTHLY', transactions);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ period: '2026-09', planned: 1000, spent: 700, remaining: 300, percentUsed: 70 });
      expect(result[1]).toMatchObject({ period: '2026-10', planned: 2000, spent: 2500, remaining: -500, percentUsed: 125 });
    });

    it('sorts periods chronologically and ignores allocations without a period', () => {
      const allocations = [
        { period: '2026-12', plannedAmount: 100 },
        { period: '2026-01', plannedAmount: 100 },
        { period: '', plannedAmount: 50 },
      ];
      const result = computePeriodBreakdown(allocations, 'MONTHLY', []);
      expect(result.map((r) => r.period)).toEqual(['2026-01', '2026-12']);
    });

    it('returns percentUsed null when nothing planned', () => {
      const result = computePeriodBreakdown([{ period: '2026', plannedAmount: 0 }], 'YEARLY', [
        { date: '2026-05-01', amount: -10 },
      ]);
      expect(result[0].percentUsed).toBeNull();
      expect(result[0].spent).toBe(10);
    });
  });

  describe('sanitizePeriodAllocations', () => {
    it('accepts well-formed rows matching the period type', () => {
      const input = [
        { period: '2026-09', plannedAmount: '500' },
        { period: '2026-10', plannedAmount: 700, note: 'отпуск' },
      ];
      const result = sanitizePeriodAllocations(input, 'MONTHLY');
      expect(result).toEqual([
        { period: '2026-09', plannedAmount: 500, note: undefined },
        { period: '2026-10', plannedAmount: 700, note: 'отпуск' },
      ]);
    });

    it('drops rows whose period key does not match the declared period type', () => {
      const input = [{ period: '2026', plannedAmount: 100 }];
      expect(sanitizePeriodAllocations(input, 'MONTHLY')).toEqual([]);
      expect(sanitizePeriodAllocations(input, 'YEARLY')).toHaveLength(1);
    });

    it('returns an empty array for non-array input', () => {
      expect(sanitizePeriodAllocations(null, 'MONTHLY')).toEqual([]);
      expect(sanitizePeriodAllocations(undefined, 'MONTHLY')).toEqual([]);
      expect(sanitizePeriodAllocations('nope', 'MONTHLY')).toEqual([]);
    });
  });
});
