/** Общие форматтеры раздела «Финансы» (Итерация 4). */

export function money(n: number | null | undefined, currency = 'RUB'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sign = currency === 'RUB' ? '₽' : currency;
  return `${Math.round(n).toLocaleString('ru-RU')} ${sign}`;
}

export function monthBounds(offset = 0): { start: string; end: string } {
  const now = new Date();
  const s = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1));
  const e = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset + 1, 0));
  return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
}

export function ruDate(iso?: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export const inputClass = 'w-full rounded-card border border-line bg-paper px-3 py-2 text-sm focus:border-moss-500';
