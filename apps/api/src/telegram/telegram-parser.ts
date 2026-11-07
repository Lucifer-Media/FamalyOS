/**
 * Telegram-бот (Итерация 4.1) — разбор сообщений «быстрой записи» и
 * вспомогательная логика. Чистые функции без Prisma/сети.
 *
 * Понимает (по одной операции на строку, до 20 строк):
 *   350 кофе            кофе 350р           1 200,50 продукты
 *   такси 800 вчера     05.11 аптека 1200   1.5к стоматолог
 *   +50000 зарплата     доход 3000 кешбэк   кино 900 личное
 */

export interface ParsedEntry {
  amount: number; // со знаком: расход < 0, доход > 0
  description: string;
  date: string; // YYYY-MM-DD
  scope?: 'PERSONAL' | 'FAMILY';
  raw: string;
}

const INCOME_WORDS = /^(доход|зарплата|зп|аванс|премия|получил[аи]?|вернули|возврат|кешб[еэ]к|кэшб[еэ]к|перевели мне)$/i;
const PERSONAL_WORDS = /^(личное|личный|личная|лично|себе|для себя)$/i;
const FAMILY_WORDS = /^(семья|семейное|семейный|общее|общий|общая)$/i;
const CURRENCY_WORDS = /^(р|р\.|руб|руб\.|рублей|рубля|₽|rub)$/i;

export function addDaysIso(date: string, days: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

/** «Сегодня» в часовом поясе семьи (контейнер обычно в UTC — после полуночи по Москве была бы вчерашняя дата). */
export function localToday(timeZone = process.env.FAMILY_TIMEZONE || 'Europe/Moscow', now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parseAmountToken(token: string): number | null {
  const t = token.toLowerCase().replace(/₽|руб\.?|р\.?$/g, '');
  const m = t.match(/^(\d+(?:[.,]\d{1,2})?)(к|k|тыс\.?)?$/);
  if (!m) return null;
  let n = Number(m[1].replace(',', '.'));
  if (m[2]) n *= 1000;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function parseEntryLine(line: string, today: string): ParsedEntry | null {
  let text = line.trim();
  if (!text) return null;
  let sign = -1;
  if (text.startsWith('+')) {
    sign = 1;
    text = text.slice(1).trim();
  } else if (/^[-−–]\s*\d/.test(text)) {
    text = text.slice(1).trim();
  }

  // Числа с пробелами-разделителями тысяч: «1 200» → «1200» (но не «05.11 1200»).
  text = text.replace(/(^|\s)(\d{1,3})(?:[  ](\d{3}))+(?=([.,]\d{1,2})?(\s|$|р|₽|к))/g, (full) => full.replace(/[  ](?=\d{3})/g, ''));

  let date = today;
  let scope: ParsedEntry['scope'];
  let amount: number | null = null;
  const words: string[] = [];

  for (const token of text.split(/\s+/)) {
    const low = token.toLowerCase().replace(/[,;!]+$/, '');
    if (low === 'сегодня') continue;
    if (low === 'вчера') {
      date = addDaysIso(today, -1);
      continue;
    }
    if (low === 'позавчера') {
      date = addDaysIso(today, -2);
      continue;
    }
    const dm = low.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
    if (dm && Number(dm[2]) >= 1 && Number(dm[2]) <= 12 && Number(dm[1]) >= 1 && Number(dm[1]) <= 31) {
      const y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : Number(today.slice(0, 4));
      let candidate = `${y}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
      // «28.12» в январе без года — это прошлый год, а не будущий.
      if (!dm[3] && candidate > today) candidate = `${y - 1}${candidate.slice(4)}`;
      date = candidate;
      continue;
    }
    if (PERSONAL_WORDS.test(low)) {
      scope = 'PERSONAL';
      continue;
    }
    if (FAMILY_WORDS.test(low)) {
      scope = 'FAMILY';
      continue;
    }
    if (CURRENCY_WORDS.test(low)) continue;
    if (amount === null) {
      const a = parseAmountToken(low);
      if (a !== null) {
        amount = a;
        continue;
      }
    }
    if (INCOME_WORDS.test(low)) sign = 1;
    words.push(token);
  }

  if (amount === null) return null;
  const description = words.join(' ').replace(/\s+/g, ' ').trim() || (sign > 0 ? 'Поступление' : 'Расход');
  return { amount: sign * amount, description: description.slice(0, 200), date, scope, raw: line.trim() };
}

/** Несколько строк — несколько операций. Строки без суммы игнорируются; null, если ни одной операции. */
export function parseEntries(text: string, today: string): ParsedEntry[] | null {
  const entries = text
    .split(/\r?\n/)
    .slice(0, 20)
    .map((l) => parseEntryLine(l, today))
    .filter((e): e is ParsedEntry => e !== null);
  return entries.length ? entries : null;
}

/**
 * Быстрая подсказка категории по ключевым словам (до ИИ). Срабатывает,
 * только если у вас есть категория с подходящим названием.
 */
const KEYWORD_CATEGORIES: { words: RegExp; category: RegExp }[] = [
  { words: /пят[её]рочк|магнит|вкусвилл|перекр[её]ст|лента|ашан|дикси|азбук|окей|metro|продукт|овощ|хлеб|молок|супермаркет/i, category: /продукт|супермаркет|еда$|^еда/i },
  { words: /кофе|кафе|ресторан|бар\b|обед|ужин|завтрак|шаурм|бургер|пицц|суши|роллы|кофейн|доставк[аи] еды/i, category: /кафе|ресторан|еда вне|общепит/i },
  { words: /врач|аптек|лекарств|анализ|стомат|зуб|клиник|при[её]м|узи|мрт|медицин|терапевт|педиатр|окулист|гинеколог|массаж/i, category: /мед|здоров|аптек|врач|лечени/i },
  { words: /такси|метро|автобус|электричк|трамва|тройк|каршер|делимобил|яндекс go/i, category: /транспорт|такси|проезд/i },
  { words: /бензин|азс|заправк|парковк|мойк|шиномонтаж|техосмотр|осаго|каско|автосервис/i, category: /авто|машин|транспорт/i },
  { words: /мтс|билайн|мегафон|теле2|интернет|ростелеком|связь|сим-?карт/i, category: /связь|интернет|телефон|мобильн/i },
  { words: /кинопоиск|ivi|okko|spotify|netflix|подписк|яндекс плюс|youtube premium|icloud|chatgpt/i, category: /подписк|сервис|развлеч/i },
  { words: /кино|театр|концерт|музей|боулинг|квест|игр[аы]|steam/i, category: /развлеч|досуг|отдых|хобби/i },
  { words: /икеа|ikea|леруа|хозтовар|бытов|посуд|ремонт/i, category: /дом|хоз|ремонт|быт/i },
  { words: /одежд|обув|куртк|джинс|zara|uniqlo|кроссовк/i, category: /одежд|обув|гардероб/i },
  { words: /аренд|квартплат|жкх|коммуналк|свет|электроэнерг|вода|газ\b/i, category: /жкх|коммунал|аренд|жиль/i },
  { words: /подарок|подарки|цвет[ыо]/i, category: /подар/i },
  { words: /спортзал|фитнес|бассейн|абонемент|тренировк|йог/i, category: /спорт|фитнес|здоров/i },
  { words: /зарплата|зп\b|аванс|премия/i, category: /зарплат|доход|оклад/i },
];

export function guessCategoryByKeywords(description: string, categories: { id: string; name: string }[]): string | undefined {
  const d = description.toLowerCase();
  // 1) Описание прямо содержит название категории («продукты», «аптека»).
  const direct = categories.find((c) => c.name.trim().length >= 3 && d.includes(c.name.trim().toLowerCase()));
  if (direct) return direct.id;
  // 2) Словарь «магазин/слово → тип категории».
  for (const rule of KEYWORD_CATEGORIES) {
    if (!rule.words.test(d)) continue;
    const cat = categories.find((c) => rule.category.test(c.name));
    if (cat) return cat.id;
  }
  return undefined;
}

// ---------- Уведомления о бюджете ----------

/**
 * Какой порог бюджета достигнут: 0 — никакой, threshold (по умолчанию 80) —
 * «подходим к лимиту», 100 — «превышен». Уведомление по каждому уровню
 * отправляется один раз за период бюджета (проверка — по журналу аудита).
 */
export function budgetAlertLevel(percentUsed: number | null | undefined, thresholdPercent?: number | null): 0 | 100 | number {
  if (percentUsed === null || percentUsed === undefined || !Number.isFinite(percentUsed)) return 0;
  const threshold = thresholdPercent && thresholdPercent > 0 && thresholdPercent < 100 ? thresholdPercent : 80;
  if (percentUsed >= 100) return 100;
  if (percentUsed >= threshold) return threshold;
  return 0;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function rub(n: number, currency = 'RUB'): string {
  const sign = currency === 'RUB' ? '₽' : currency;
  // Копейки — если есть (378,45 ₽): раньше округлялось до рублей.
  return `${n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ')} ${sign}`;
}

/** Упрощённый перевод Markdown отчёта ИИ в Telegram-HTML (заголовки → жирный, **x** → <b>). */
export function markdownToTelegramHtml(md: string): string {
  return escapeHtml(md)
    .replace(/^#{1,6}\s*(.+)$/gm, '<b>$1</b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1<i>$2</i>')
    .replace(/^\s*[-*]\s+/gm, '• ');
}

/** Telegram ограничивает сообщение 4096 символами. */
export function truncateForTelegram(text: string, max = 3900): string {
  return text.length <= max ? text : text.slice(0, max) + '\n…';
}

export function parseAllowedChatIds(raw?: string): Set<string> {
  return new Set(
    (raw ?? '')
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^-?\d+$/.test(s)),
  );
}

export interface AccountCandidate {
  id: string;
  name: string;
  bankName?: string;
  ownerPersonId?: string | null;
  ownerName?: string;
  isShared?: boolean;
}

export interface AccountResolution {
  accountId?: string;
  /** Несколько счетов подходят одинаково — нужно спросить кнопками. */
  ambiguous?: string[];
  /** Строка без слов, по которым определён счёт. */
  text: string;
}

const GENERIC_ACCOUNT_WORDS = new Set(['счет', 'счета', 'счету', 'сч', 'карта', 'карты', 'карту', 'картой', 'банк', 'банка', 'с', 'со', 'на', 'по']);
const SCOPE_LIKE = /^(семейн|личн|общ)/;

/** Банк → слова, которыми его называют в сообщениях. */
export function bankAliases(bankName?: string): string[] {
  const b = (bankName ?? '').toLowerCase().replace(/ё/g, 'е');
  if (!b) return [];
  const out = new Set<string>();
  if (/тинь|t-?bank|т-?банк|tinkoff/.test(b)) ['тиньк', 'тинькофф', 'тбанк', 'т-банк', 'tinkoff', 'tbank'].forEach((x) => out.add(x));
  if (/альф|alfa/.test(b)) ['альфа', 'альфабанк', 'alfa'].forEach((x) => out.add(x));
  if (/сбер|sber/.test(b)) ['сбер', 'сбербанк', 'sber'].forEach((x) => out.add(x));
  if (/втб|vtb/.test(b)) ['втб', 'vtb'].forEach((x) => out.add(x));
  if (/озон|ozon/.test(b)) ['озон', 'ozon'].forEach((x) => out.add(x));
  if (/яндекс|yandex/.test(b)) ['яндекс', 'yandex'].forEach((x) => out.add(x));
  if (/газпром|гпб/.test(b)) ['газпром', 'гпб'].forEach((x) => out.add(x));
  if (/райф/.test(b)) ['райф', 'райффайзен'].forEach((x) => out.add(x));
  if (/совком|халв/.test(b)) ['совком', 'халва'].forEach((x) => out.add(x));
  if (/мтс/.test(b)) out.add('мтс');
  if (/почт/.test(b)) out.add('почта');
  for (const w of b.split(/[\s,.()«»"/]+/)) if (w.length >= 3 && w !== 'банк' && w !== 'bank') out.add(w);
  return [...out];
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
const clean = (w: string) => norm(w).replace(/[^\p{L}\d-]/gu, '');
const prefixMatch = (w: string, k: string) => w.length >= 3 && k.length >= 3 && (k.startsWith(w) || w.startsWith(k));

/**
 * Определяет счёт по словам сообщения: наименование счёта, банк и владелец.
 *   «семейный счёт альфа» → «Семейный счёт» в Альфа-Банке,
 *   «семейный счёт тиньк» → «Семейный счёт» в Т-Банке,
 *   «основной» → «Основной» счёт того, кто пишет (senderPersonId).
 * Ничья → ambiguous (спросить кнопками). Если совпали только слова вида
 * «семейный/личный» и счёт не однозначен — это тип расхода, а не счёт.
 */
export function resolveAccountInText(text: string, accounts: AccountCandidate[], senderPersonId?: string | null): AccountResolution {
  const words = text.split(/\s+/).filter(Boolean);
  const scored = accounts.map((a) => {
    const nameWords = norm(a.name).split(/[\s,.()«»"/]+/).filter((w) => w.length >= 3 && !GENERIC_ACCOUNT_WORDS.has(w));
    const bankWords = bankAliases(a.bankName);
    const ownerWords = a.ownerName ? norm(a.ownerName).split(/\s+/).filter((w) => w.length >= 3) : [];
    let score = 0;
    let onlyScopeWords = true;
    const used = new Set<number>();
    words.forEach((raw, idx) => {
      const w = clean(raw);
      if (w.length < 3 || GENERIC_ACCOUNT_WORDS.has(w) || /^\d/.test(w)) return;
      if (nameWords.some((k) => prefixMatch(w, k))) {
        score += 2;
        used.add(idx);
        // «семейный» само по себе — тип расхода; «семейный счёт» — явно счёт.
        const near = [words[idx - 1], words[idx + 1]].map((x) => (x ? clean(x) : ''));
        if (!SCOPE_LIKE.test(w) || near.some((x) => /^(сч|карт)/.test(x))) onlyScopeWords = false;
      } else if (bankWords.some((k) => prefixMatch(w, k))) {
        score += 2;
        used.add(idx);
        onlyScopeWords = false;
      } else if (ownerWords.some((k) => prefixMatch(w, k))) {
        score += 1;
        used.add(idx);
        onlyScopeWords = false;
      }
    });
    return { a, score, used, onlyScopeWords };
  });

  const best = Math.max(0, ...scored.map((s) => s.score));
  if (best === 0) return { text };
  let top = scored.filter((s) => s.score === best);
  if (top.length > 1 && senderPersonId) {
    const mine = top.filter((s) => s.a.ownerPersonId === senderPersonId && !s.a.isShared);
    if (mine.length === 1) top = mine;
  }
  if (top.length > 1) {
    if (top.every((s) => s.onlyScopeWords)) return { text }; // «продукты 2000 семейный» — это тип расхода
    // Общие для всех подходящих счетов слова («семейный счёт») — тоже убираем из описания.
    const common = [...top[0].used].filter((i) => top.every((t) => t.used.has(i)));
    return { ambiguous: top.map((s) => s.a.id), text: stripWords(words, new Set(common)) || text };
  }
  const winner = top[0];
  if (winner.onlyScopeWords && scored.filter((s) => s.score > 0).length > 1) return { text };
  return { accountId: winner.a.id, text: stripWords(words, winner.used) || text };
}

/** Убирает слова счёта и стоящие рядом «счёт/карта/банк». */
function stripWords(words: string[], used: Set<number>): string {
  const drop = new Set(used);
  for (const idx of used) for (const j of [idx - 1, idx + 1]) if (j >= 0 && j < words.length && GENERIC_ACCOUNT_WORDS.has(clean(words[j])) && clean(words[j]).length >= 3) drop.add(j);
  return words.filter((_, i) => !drop.has(i)).join(' ').trim();
}

/** Совместимость: простой вариант без банка/владельца. */
export function matchAccountInText(description: string, accounts: { id: string; name: string }[]): { accountId?: string; description: string } {
  const r = resolveAccountInText(description, accounts);
  return { accountId: r.accountId, description: r.text };
}
