/**
 * Визуальная принадлежность банковских счетов к банкам (пункт 3 запроса
 * на доработку). Источник цвета — по приоритету:
 *   1. Ручной цвет счёта (bank_account.brandColorOverride)
 *   2. Цвет банка из справочника (bank.brandColor), если счёт связан
 *   3. Эвристика по известным российским банкам (по названию)
 *   4. Детерминированный цвет, посчитанный из названия (стабилен между
 *      перезагрузками, просто не "настоящий" фирменный)
 */

export interface BankBrand {
  initials: string;
  bg: string;
  fg: string;
}

const KNOWN_BANKS: { match: RegExp; bg: string; fg: string }[] = [
  { match: /т-банк|тинькофф|tinkoff|t-bank/i, bg: '#FFDD2D', fg: '#1A1A1A' },
  { match: /альфа/i, bg: '#EF3124', fg: '#FFFFFF' },
  { match: /сбер/i, bg: '#21A038', fg: '#FFFFFF' },
  { match: /\bвтб\b/i, bg: '#0A2896', fg: '#FFFFFF' },
  { match: /газпромбанк|\bгпб\b/i, bg: '#0033A0', fg: '#FFFFFF' },
  { match: /райффайзен/i, bg: '#FFED00', fg: '#1A1A1A' },
  { match: /открытие/i, bg: '#4DB45E', fg: '#FFFFFF' },
  { match: /росбанк/i, bg: '#E4032E', fg: '#FFFFFF' },
  { match: /совкомбанк/i, bg: '#00A0DC', fg: '#FFFFFF' },
  { match: /озон/i, bg: '#005BFF', fg: '#FFFFFF' },
  { match: /яндекс/i, bg: '#FFCC00', fg: '#1A1A1A' },
  { match: /почта\s*банк/i, bg: '#1F3A93', fg: '#FFFFFF' },
  { match: /\bмтс\b/i, bg: '#E30611', fg: '#FFFFFF' },
  { match: /наличные|cash/i, bg: '#8D8D8D', fg: '#FFFFFF' },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function isValidHex(v?: string | null): v is string {
  return !!v && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
}

function contrastFor(hex: string): string {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1A1A1A' : '#FFFFFF';
}

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

export function getBankBrand(bankName?: string | null, overrideColor?: string | null): BankBrand {
  const name = (bankName ?? '').trim();
  const label = initials(name || '?');

  if (isValidHex(overrideColor)) {
    return { initials: label, bg: overrideColor as string, fg: contrastFor(overrideColor as string) };
  }
  for (const bank of KNOWN_BANKS) {
    if (bank.match.test(name)) return { initials: label, bg: bank.bg, fg: bank.fg };
  }
  if (!name) return { initials: '?', bg: '#94A3B8', fg: '#FFFFFF' };
  return { initials: label, bg: hashColor(name), fg: '#FFFFFF' };
}
