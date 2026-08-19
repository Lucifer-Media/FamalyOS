/**
 * Парсер банковских выписок для импорта финансовых операций.
 * Поддерживаемые форматы: OFX, CSV (Т-Банк, Альфа-Банк), XLSX (Т-Банк, Альфа-Банк)
 * БЕЗ обращения к внешним API — только локальная обработка файлов.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ParsedOperation {
  operationDate: Date;
  operationTime?: string;
  amount: number;
  currency: string;
  originalAmount?: number;
  originalCurrency?: string;
  exchangeRate?: number;
  operationType: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  category?: string;
  description?: string;
  merchantName?: string;
  merchantInn?: string;
  sourceAccountNumber?: string;
  targetAccountNumber?: string;
  importUniqueId: string; // Уникальный ID для дедупликации
  rawLine?: string; // Исходная строка для отладки
}

export interface ParseResult {
  operations: ParsedOperation[];
  accountNumber?: string;
  bankName?: string;
  periodStart?: Date;
  periodEnd?: Date;
  errors: string[];
}

// ---------- Вспомогательные функции ----------

function parseDateRU(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  // Форматы: DD.MM.YYYY, DD.MM.YY, YYYY-MM-DD, DD/MM/YYYY
  const formats = [
    /^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})$/,
    /^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2})$/,
    /^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/,
    /^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/,
  ];
  
  for (const format of formats) {
    const match = dateStr.trim().match(format);
    if (match) {
      let day: number, month: number, year: number;
      
      if (format.source.includes('YYYY')) {
        if (format.source.startsWith('^\\\\d{4}')) {
          // YYYY-MM-DD
          year = parseInt(match[1], 10);
          month = parseInt(match[2], 10) - 1;
          day = parseInt(match[3], 10);
        } else {
          // DD.MM.YYYY или DD/MM/YYYY
          day = parseInt(match[1], 10);
          month = parseInt(match[2], 10) - 1;
          year = parseInt(match[3], 10);
        }
      } else {
        // DD.MM.YY
        day = parseInt(match[1], 10);
        month = parseInt(match[2], 10) - 1;
        year = parseInt(match[3], 10);
        year += year < 50 ? 2000 : 1900;
      }
      
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }
  
  return null;
}

function parseAmount(amountStr: string): number | null {
  if (!amountStr) return null;
  // Заменяем запятую на точку, убираем пробелы и знаки валют
  const cleaned = amountStr.toString().replace(/[^\\d.,-]/g, '').replace(',', '.');
  const amount = parseFloat(cleaned);
  return isNaN(amount) ? null : amount;
}

function determineOperationType(amount: number, incomeColumn?: string): 'INCOME' | 'EXPENSE' | 'TRANSFER' {
  if (incomeColumn !== undefined) {
    return incomeColumn ? 'INCOME' : 'EXPENSE';
  }
  return amount >= 0 ? 'INCOME' : 'EXPENSE';
}

function generateUniqueId(fields: Record<string, any>): string {
  // Генерируем уникальный ID на основе даты, суммы и описания
  const str = JSON.stringify(fields);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16) + '-' + Date.now().toString(16);
}

// ---------- Парсер OFX ----------

function parseOFX(content: string): ParseResult {
  const errors: string[] = [];
  const operations: ParsedOperation[] = [];
  
  try {
    // OFX использует SGML-подобный формат
    const lines = content.split('\\n');
    let currentTransaction: Partial<ParsedOperation> = {};
    let inTransaction = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed === '<STMTTRN>') {
        inTransaction = true;
        currentTransaction = {};
      } else if (trimmed === '</STMTTRN>') {
        if (currentTransaction.operationDate && currentTransaction.amount !== undefined) {
          operations.push({
            operationDate: currentTransaction.operationDate!,
            operationTime: currentTransaction.operationTime,
            amount: currentTransaction.amount!,
            currency: currentTransaction.currency || 'RUB',
            originalAmount: currentTransaction.originalAmount,
            originalCurrency: currentTransaction.originalCurrency,
            operationType: currentTransaction.operationType || determineOperationType(currentTransaction.amount!),
            description: currentTransaction.description,
            merchantName: currentTransaction.merchantName,
            importUniqueId: generateUniqueId({
              date: currentTransaction.operationDate?.toISOString(),
              amount: currentTransaction.amount,
              desc: currentTransaction.description,
            }),
            rawLine: undefined,
          });
        }
        inTransaction = false;
      } else if (inTransaction) {
        // Парсим теги внутри транзакции
        const tagMatch = trimmed.match(/^<(\\w+)>(.*)$/);
        if (tagMatch) {
          const [, tag, value] = tagMatch;
          
          switch (tag) {
            case 'DTPOSTED':
              // Формат YYYYMMDDHHMMSS
              if (value.length >= 8) {
                const year = parseInt(value.slice(0, 4), 10);
                const month = parseInt(value.slice(4, 6), 10) - 1;
                const day = parseInt(value.slice(6, 8), 10);
                const hour = value.length >= 10 ? parseInt(value.slice(8, 10), 10) : 0;
                const minute = value.length >= 12 ? parseInt(value.slice(10, 12), 10) : 0;
                currentTransaction.operationDate = new Date(year, month, day, hour, minute);
              }
              break;
            case 'TRNAMT':
              currentTransaction.amount = parseAmount(value) || undefined;
              break;
            case 'CURSYM':
              currentTransaction.currency = value;
              break;
            case 'FITID':
              currentTransaction.importUniqueId = value;
              break;
            case 'NAME':
            case 'MEMO':
              currentTransaction.description = value;
              break;
            case 'TRNTYPE':
              currentTransaction.operationType = value === 'CREDIT' ? 'INCOME' : 'EXPENSE';
              break;
          }
        }
      }
    }
  } catch (e) {
    errors.push(`Ошибка парсинга OFX: ${(e as Error).message}`);
  }
  
  return { operations, errors };
}

// ---------- Парсер CSV (Т-Банк, Альфа-Банк) ----------

function parseCSV(content: string, bankFormat: 'TINKOFF' | 'ALFA'): ParseResult {
  const errors: string[] = [];
  const operations: ParsedOperation[] = [];
  
  try {
    const lines = content.split('\\n').filter(line => line.trim());
    if (lines.length < 2) {
      errors.push('Файл слишком короткий или пустой');
      return { operations, errors };
    }
    
    // Определяем заголовки
    const headerLine = lines[0];
    const headers = headerLine.split(';').map(h => h.trim().replace(/"/g, ''));
    
    // Индексы колонок
    let dateIdx = -1, timeIdx = -1, amountIdx = -1, currencyIdx = -1;
    let descIdx = -1, merchantIdx = -1, categoryIdx = -1, innIdx = -1;
    let incomeIdx = -1, expenseIdx = -1, balanceIdx = -1;
    
    headers.forEach((h, idx) => {
      const lower = h.toLowerCase();
      if (lower.includes('дата')) dateIdx = idx;
      else if (lower.includes('время') && !lower.includes('операции')) timeIdx = idx;
      else if (lower.includes('сумма') && !lower.includes('расход') && !lower.includes('доход')) amountIdx = idx;
      else if (lower.includes('валюта')) currencyIdx = idx;
      else if (lower.includes('описание') || lower.includes('назначение')) descIdx = idx;
      else if (lower.includes('merchant') || lower.includes('продавец') || lower.includes('контрагент')) merchantIdx = idx;
      else if (lower.includes('категория')) categoryIdx = idx;
      else if (lower.includes('инн')) innIdx = idx;
      else if (lower.includes('доход') || lower.includes('приход')) incomeIdx = idx;
      else if (lower.includes('расход')) expenseIdx = idx;
      else if (lower.includes('баланс') || lower.includes('остаток')) balanceIdx = idx;
    });
    
    // Парсим строки данных
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Простой сплит по точке с запятой (для сложных случаев нужен CSV-парсер)
      const values = line.split(';').map(v => v.trim().replace(/^"|"$/g, ''));
      
      if (values.length < headers.length) continue;
      
      const dateStr = dateIdx >= 0 ? values[dateIdx] : '';
      const parsedDate = parseDateRU(dateStr);
      if (!parsedDate) continue;
      
      const timeStr = timeIdx >= 0 ? values[timeIdx] : undefined;
      
      let amount: number | null = null;
      let operationType: 'INCOME' | 'EXPENSE' | 'TRANSFER' = 'EXPENSE';
      
      if (incomeIdx >= 0 && expenseIdx >= 0) {
        // Формат с отдельными колонками дохода/расхода
        const income = parseAmount(values[incomeIdx]);
        const expense = parseAmount(values[expenseIdx]);
        
        if (income && income > 0) {
          amount = income;
          operationType = 'INCOME';
        } else if (expense && expense > 0) {
          amount = -expense;
          operationType = 'EXPENSE';
        }
      } else if (amountIdx >= 0) {
        amount = parseAmount(values[amountIdx]);
        if (amount !== null) {
          operationType = determineOperationType(amount);
        }
      }
      
      if (amount === null) continue;
      
      const currency = currencyIdx >= 0 ? values[currencyIdx] : 'RUB';
      const description = descIdx >= 0 ? values[descIdx] : undefined;
      const merchantName = merchantIdx >= 0 ? values[merchantIdx] : undefined;
      const category = categoryIdx >= 0 ? values[categoryIdx] : undefined;
      const merchantInn = innIdx >= 0 ? values[innIdx] : undefined;
      
      operations.push({
        operationDate: parsedDate,
        operationTime: timeStr,
        amount: Math.abs(amount),
        currency: currency.toUpperCase() || 'RUB',
        operationType,
        category,
        description,
        merchantName,
        merchantInn,
        importUniqueId: generateUniqueId({
          date: parsedDate.toISOString(),
          amount,
          desc: description,
          merchant: merchantName,
        }),
        rawLine: line,
      });
    }
  } catch (e) {
    errors.push(`Ошибка парсинга CSV: ${(e as Error).message}`);
  }
  
  return { operations, errors };
}

// ---------- Экспортные функции ----------

/**
 * Парсит файл выписки в зависимости от расширения и содержимого.
 * @param filePath Путь к файлу
 * @param bankFormat Формат банка (для CSV/XLSX)
 */
export function parseBankStatement(filePath: string, bankFormat?: 'TINKOFF' | 'ALFA'): ParseResult {
  const ext = path.extname(filePath).toLowerCase();
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    if (ext === '.ofx') {
      return parseOFX(content);
    } else if (ext === '.csv') {
      const format = bankFormat || detectCSVFormat(content);
      return parseCSV(content, format);
    } else if (ext === '.xlsx' || ext === '.xls') {
      // Для XLSX требуется библиотека xlsx / exceljs
      // Здесь заглушка - реальная реализация потребует установки зависимости
      throw new Error('Парсинг XLSX требует установки библиотеки xlsx. Используйте CSV или OFX.');
    } else {
      throw new Error(`Неподдерживаемый формат файла: ${ext}`);
    }
  } catch (e) {
    return {
      operations: [],
      errors: [`Ошибка чтения файла: ${(e as Error).message}`],
    };
  }
}

/**
 * Определяет формат CSV по содержимому заголовков.
 */
function detectCSVFormat(content: string): 'TINKOFF' | 'ALFA' {
  const firstLines = content.split('\\n').slice(0, 5).join('\\n').toLowerCase();
  
  if (firstLines.includes('т-банк') || firstLines.includes('tinkoff') || firstLines.includes('типа операции')) {
    return 'TINKOFF';
  }
  
  if (firstLines.includes('альфа') || firstLines.includes('alfa') || firstLines.includes('контрагент')) {
    return 'ALFA';
  }
  
  // По умолчанию пробуем универсальный парсер
  return 'TINKOFF';
}

/**
 * Создаёт превью импорта для отображения пользователю.
 */
export function createImportPreview(operations: ParsedOperation[], limit = 50) {
  return operations.slice(0, limit).map(op => ({
    date: op.operationDate.toISOString().split('T')[0],
    time: op.operationTime,
    amount: op.amount,
    currency: op.currency,
    type: op.operationType,
    description: op.description,
    merchant: op.merchantName,
    category: op.category,
    isDuplicate: false, // Будет заполнено при проверке против существующих операций
  }));
}
