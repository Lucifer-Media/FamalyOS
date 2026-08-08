/**
 * Извлечение позиций (товаров) кассового чека из распознанного OCR-текста.
 * БЕЗ обращения к ФНС (по решению владельца системы — не реализуем в этой
 * итерации) — только эвристический разбор текстовых строк чека.
 *
 * Российские чеки обычно перечисляют позиции как минимум в одном из видов:
 *   "Название товара       1 x  199.00 =   199.00"
 *   "Название товара            199.00"
 *   "Название товара  2  99.50  199.00"
 * Это ЭВРИСТИКА — не парсер конкретного формата ККТ, поэтому:
 *  - не гарантирует 100% точность на всех форматах чеков;
 *  - никогда не заменяет официальные данные ФНС, если они станут доступны
 *    (Итерация 3-4, см. docs/TECH_DEBT.md);
 *  - всегда проходит через подтверждение пользователем как часть общего
 *    механизма DocumentIntake.
 */

export interface ReceiptItem {
  name: string;
  quantity: number | null;
  price: number | null;
  amount: number;
}

export interface ReceiptExtraction {
  items: ReceiptItem[];
  totalAmount: number | null;
}

// "199.00" или "199,00" или "199" — суммы в чеках РФ.
const AMOUNT_RE = /(\d[\d\s]*(?:[.,]\d{2})?)\s*$/;
// Строка вида "Название  2 x 99.50" или "Название  2шт  99.50"
const QTY_PRICE_RE = /(\d+(?:[.,]\d+)?)\s*(?:x|х|шт\.?)?\s*[x×]?\s*(\d+[.,]\d{2})/i;

const NOISE_LINE_RE =
  /^(итог|итого|сумма|наличными|безналичн|карт[аой]|сдача|ндс|кассир|чек|смена|фп|фд|фн|инн|адрес|время|дата)/i;

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(',', '.');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Извлекает позиции чека построчно. Строки, явно относящиеся к служебной
 * информации чека (итог, НДС, реквизиты), исключаются из товарных позиций.
 */
export function extractReceiptItems(ocrText: string): ReceiptExtraction {
  const lines = ocrText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 2);

  const items: ReceiptItem[] = [];
  let totalAmount: number | null = null;

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Строка "итого"/"сумма" — отдельно ищем итоговую сумму документа.
    if (/итог|итого|к оплате|сумма\s*[:=]?\s*\d/i.test(lower)) {
      const m = line.match(AMOUNT_RE);
      if (m) {
        const amount = parseAmount(m[1]);
        if (amount != null) totalAmount = amount;
      }
      continue;
    }

    if (NOISE_LINE_RE.test(lower)) continue;

    // Строка должна заканчиваться суммой (характерно для позиции чека).
    const amountMatch = line.match(AMOUNT_RE);
    if (!amountMatch) continue;
    const amount = parseAmount(amountMatch[1]);
    if (amount == null || amount <= 0) continue;

    const namepart = line.slice(0, line.length - amountMatch[0].length).trim();
    if (namepart.length < 2) continue; // похоже на служебную строку без названия

    const qtyPriceMatch = namepart.match(QTY_PRICE_RE) ?? line.match(QTY_PRICE_RE);
    let quantity: number | null = null;
    let price: number | null = null;
    let name = namepart;
    if (qtyPriceMatch) {
      quantity = parseAmount(qtyPriceMatch[1]);
      price = parseAmount(qtyPriceMatch[2]);
      name = namepart.slice(0, namepart.indexOf(qtyPriceMatch[0])).trim() || namepart;
    }

    items.push({ name, quantity, price, amount });
  }

  return { items, totalAmount };
}

/** Текстовое представление списка позиций для поля `items` (type: 'text') в реестре типов. */
export function formatReceiptItemsAsText(items: ReceiptItem[]): string {
  return items
    .map((i) => {
      const qty = i.quantity ? ` × ${i.quantity}` : '';
      const price = i.price ? ` (${i.price} за ед.)` : '';
      return `${i.name}${qty}${price} — ${i.amount}`;
    })
    .join('\n');
}
