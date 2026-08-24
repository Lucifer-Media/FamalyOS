/**
 * Разбор банковских выписок из разных источников в единый нормализованный
 * формат. Проверено на реальных экспортах: Т-Банк (CSV/XLSX, ';', русские
 * заголовки), Альфа-Банк (CSV на английском, XLSX на русском — два разных
 * экспорта одного банка), общий стандарт OFX 2.02.
 *
 * ВАЖНО: это разбор СТРУКТУРИРОВАННЫХ данных (не OCR) — банк уже отдаёт
 * точные числа и тексты, поэтому здесь нет "уверенности распознавания" в
 * смысле OCR. Но данные всё равно проходят через подтверждение пользователем
 * перед созданием реальных операций (тот же принцип, что и для документов) —
 * ошибка сопоставления колонок или неверно опознанный формат не должны
 * молча испортить финансовые записи.
 */

export interface ParsedTransaction {
  date: string; // ISO YYYY-MM-DD
  amount: number; // отрицательное — расход, положительное — доход (нормализовано)
  currency: string;
  description: string;
  counterparty?: string;
  category?: string;
  /** Идентификатор от банка (FITID в OFX) или сгенерированный хэш —
   * основа для обнаружения дублей при повторном импорте той же выписки. */
  externalId: string;
  sourceFormat: 'ofx' | 'tbank_csv' | 'alfabank_csv' | 'alfabank_csv_ru' | 'generic_csv';
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  detectedFormat: string;
  accountHint?: { accountNumber?: string; bankName?: string; currency?: string };
  warnings: string[];
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function ruDateToIso(ruDate: string): string | null {
  const m = ruDate.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseRuAmount(raw: string | number): number {
  if (typeof raw === 'number') return raw;
  const cleaned = raw.replace(/\s/g, '').replace(',', '.');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

/** Excel хранит даты как число дней с 1899-12-30 (с поправкой на баг Lotus 1-2-3
 * про несуществующий день 29.02.1900). Формула через смещение 25569 —
 * количество дней между эпохой Excel и эпохой Unix (01.01.1970) — стандартный,
 * проверенный способ конвертации, используемый большинством библиотек. */
function excelSerialDateToIso(serial: number): string {
  const ms = (serial - 25569) * 86400 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------- OFX ----------

function parseOfx(text: string): ParseResult {
  const warnings: string[] = [];
  const transactions: ParsedTransaction[] = [];

  const currencyMatch = text.match(/<CURDEF>([A-Z]{3})/);
  const accountMatch = text.match(/<ACCTID>([^\s<]+)/);
  const bankMatch = text.match(/<BANKID>([^\s<]+)/);
  const defaultCurrency = currencyMatch?.[1] ?? 'RUB';

  const trnBlocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/g) ?? [];
  for (const block of trnBlocks) {
    const type = block.match(/<TRNTYPE>([^\s<]+)/)?.[1];
    const dtPosted = block.match(/<DTPOSTED>(\d{8})/)?.[1];
    const amountRaw = block.match(/<TRNAMT>(-?[\d.]+)/)?.[1];
    const fitId = block.match(/<FITID>([^\s<]+)/)?.[1];
    const name = block.match(/<NAME>([^\r\n<]+)/)?.[1]?.trim();
    const memo = block.match(/<MEMO>([^\r\n<]+)/)?.[1]?.trim();
    const cursym = block.match(/<CURSYM>([A-Z]{3})/)?.[1];

    if (!dtPosted || amountRaw === undefined) {
      warnings.push('Пропущена запись операции без даты или суммы');
      continue;
    }
    const iso = `${dtPosted.slice(0, 4)}-${dtPosted.slice(4, 6)}-${dtPosted.slice(6, 8)}`;
    const amount = Number(amountRaw);
    transactions.push({
      date: iso,
      amount,
      currency: cursym ?? defaultCurrency,
      description: memo || name || (type === 'CREDIT' ? 'Поступление' : 'Списание'),
      counterparty: name,
      externalId: fitId ?? simpleHash(`${iso}|${amountRaw}|${name}|${memo}`),
      sourceFormat: 'ofx',
    });
  }

  return {
    transactions,
    detectedFormat: 'OFX 2.02',
    accountHint: { accountNumber: accountMatch?.[1], bankName: bankMatch?.[1], currency: defaultCurrency },
    warnings,
  };
}

// ---------- CSV (Т-Банк и Альфа-Банк) ----------

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseCsvRows(text: string, delimiter: string): string[][] {
  return text
    .replace(/^\uFEFF/, '') // BOM
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => splitCsvLine(l, delimiter));
}

function parseTbankCsv(text: string): ParseResult {
  const rows = parseCsvRows(text, ';');
  const header = rows[0]?.map((h) => h.replace(/^"|"$/g, ''));
  const idx = (name: string) => header?.indexOf(name) ?? -1;
  const iDate = idx('Дата операции');
  const iAmount = idx('Сумма операции');
  const iCurrency = idx('Валюта операции');
  const iCategory = idx('Категория');
  const iDescription = idx('Описание');

  const transactions: ParsedTransaction[] = [];
  const warnings: string[] = [];

  for (const row of rows.slice(1)) {
    const cell = (i: number) => row[i]?.replace(/^"|"$/g, '') ?? '';
    const rawDate = cell(iDate);
    const iso = ruDateToIso(rawDate);
    if (!iso) {
      warnings.push(`Не удалось разобрать дату: "${rawDate}"`);
      continue;
    }
    const amount = parseRuAmount(cell(iAmount));
    const description = cell(iDescription) || cell(iCategory) || 'Операция';
    transactions.push({
      date: iso,
      amount,
      currency: cell(iCurrency) || 'RUB',
      description,
      category: cell(iCategory) || undefined,
      externalId: simpleHash(`${iso}|${amount}|${description}|${row.join('|')}`),
      sourceFormat: 'tbank_csv',
    });
  }

  return { transactions, detectedFormat: 'Т-Банк (CSV/XLSX экспорт)', warnings };
}

function parseAlfaBankCsv(text: string): ParseResult {
  const rows = parseCsvRows(text, ',');
  const header = rows[0];
  const isRussian = header.includes('Дата операции');
  const idx = (nameEn: string, nameRu: string) =>
    isRussian ? header.indexOf(nameRu) : header.indexOf(nameEn);

  const iDate = idx('operationDate', 'Дата операции');
  const iAmount = idx('amount', 'Сумма');
  const iCurrency = idx('currency', 'Валюта');
  const iMerchant = idx('merchant', 'Описание операции');
  const iCategory = idx('category', 'Категория');
  const iType = idx('type', 'Тип');

  const transactions: ParsedTransaction[] = [];
  const warnings: string[] = [];

  for (const row of rows.slice(1)) {
    const cell = (i: number) => row[i]?.replace(/^"|"$/g, '') ?? '';
    const rawDate = cell(iDate);
    const iso = ruDateToIso(rawDate);
    if (!iso) {
      warnings.push(`Не удалось разобрать дату: "${rawDate}"`);
      continue;
    }
    let amount = parseRuAmount(cell(iAmount));
    // В отличие от Т-Банка, Альфа-Банк не проставляет знак в сумме —
    // направление определяется отдельным полем "Тип" (Списание/Пополнение).
    const type = cell(iType).toLowerCase();
    if (type.includes('списание') && amount > 0) amount = -amount;

    const description = cell(iMerchant) || cell(iCategory) || 'Операция';
    transactions.push({
      date: iso,
      amount,
      currency: cell(iCurrency) === 'RUR' ? 'RUB' : cell(iCurrency) || 'RUB',
      description,
      category: cell(iCategory) || undefined,
      externalId: simpleHash(`${iso}|${amount}|${description}|${row.join('|')}`),
      sourceFormat: isRussian ? 'alfabank_csv_ru' : 'alfabank_csv',
    });
  }

  return { transactions, detectedFormat: 'Альфа-Банк (CSV/XLSX экспорт)', warnings };
}

// ---------- Определение формата и точка входа ----------

export function parseBankStatementText(text: string, filenameHint = ''): ParseResult {
  const trimmed = text.trim();
  if (trimmed.startsWith('<?xml') || trimmed.includes('<OFX>')) {
    return parseOfx(text);
  }

  const firstLine = trimmed.split(/\r?\n/)[0] ?? '';
  if (firstLine.includes(';') && firstLine.includes('Дата операции')) {
    return parseTbankCsv(text);
  }
  if (firstLine.includes(',') && (firstLine.includes('operationDate') || firstLine.includes('Дата операции'))) {
    return parseAlfaBankCsv(text);
  }

  return {
    transactions: [],
    detectedFormat: 'unknown',
    warnings: [`Формат файла "${filenameHint}" не распознан — поддерживаются OFX, Т-Банк CSV, Альфа-Банк CSV`],
  };
}

/**
 * Разбор строк из XLSX (уже прочитанных через SheetJS в вызывающем коде —
 * этот модуль не тянет зависимость от xlsx напрямую, чтобы оставаться
 * тестируемым без файлового ввода-вывода). Строки — это результат
 * XLSX.utils.sheet_to_json(sheet, { header: 1 }).
 */
export function parseBankStatementRows(rows: unknown[][]): ParseResult {
  const header = (rows[0] as string[]) ?? [];
  const isTbank = header.includes('Дата операции') && header.includes('Сумма операции');
  const isAlfaRu = header.includes('Дата операции') && header.includes('Сумма') && header.includes('Название счета');

  const warnings: string[] = [];
  const transactions: ParsedTransaction[] = [];

  const idx = (name: string) => header.indexOf(name);

  if (isAlfaRu) {
    const iDate = idx('Дата операции');
    const iAmount = idx('Сумма');
    const iCurrency = idx('Валюта');
    const iMerchant = idx('Описание операции');
    const iCategory = idx('Категория');
    const iType = idx('Тип');

    for (const row of rows.slice(1) as unknown[][]) {
      const cell = (i: number) => (row[i] != null ? String(row[i]) : '');
      const rawDate = cell(iDate);
      const iso = ruDateToIso(rawDate);
      if (!iso) {
        warnings.push(`Не удалось разобрать дату: "${rawDate}"`);
        continue;
      }
      let amount = parseRuAmount(cell(iAmount));
      const type = cell(iType).toLowerCase();
      if (type.includes('списание') && amount > 0) amount = -amount;
      const description = cell(iMerchant) || cell(iCategory) || 'Операция';
      transactions.push({
        date: iso,
        amount,
        currency: cell(iCurrency) === 'RUR' ? 'RUB' : cell(iCurrency) || 'RUB',
        description,
        category: cell(iCategory) || undefined,
        externalId: simpleHash(`${iso}|${amount}|${description}|${row.join('|')}`),
        sourceFormat: 'alfabank_csv_ru',
      });
    }
    return { transactions, detectedFormat: 'Альфа-Банк (XLSX экспорт)', warnings };
  }

  if (isTbank) {
    const iDate = idx('Дата операции');
    const iAmount = idx('Сумма операции');
    const iCurrency = idx('Валюта операции');
    const iCategory = idx('Категория');
    const iDescription = idx('Описание');

    for (const row of rows.slice(1) as unknown[][]) {
      const rawDateCell = row[iDate];
      // Т-Банк в XLSX отдаёт дату как число Excel (дни с 1899-12-30), а не строку.
      const iso =
        typeof rawDateCell === 'number' ? excelSerialDateToIso(rawDateCell) : ruDateToIso(String(rawDateCell ?? ''));
      if (!iso) {
        warnings.push(`Не удалось разобрать дату: "${rawDateCell}"`);
        continue;
      }
      const cell = (i: number) => (row[i] != null ? String(row[i]) : '');
      const amount = parseRuAmount(row[iAmount] as string | number);
      const description = cell(iDescription) || cell(iCategory) || 'Операция';
      transactions.push({
        date: iso,
        amount,
        currency: cell(iCurrency) || 'RUB',
        description,
        category: cell(iCategory) || undefined,
        externalId: simpleHash(`${iso}|${amount}|${description}|${row.join('|')}`),
        sourceFormat: 'tbank_csv',
      });
    }
    return { transactions, detectedFormat: 'Т-Банк (XLSX экспорт)', warnings };
  }

  return {
    transactions: [],
    detectedFormat: 'unknown',
    warnings: ['Формат XLSX не распознан — поддерживаются экспорты Т-Банка и Альфа-Банка'],
  };
}
