/**
 * ИИ-подсказки категорий для операций без категории (Итерация 4).
 * Модель выбирает ТОЛЬКО из существующего справочника; всё, что не
 * совпало точно с названием категории, отбрасывается. Результат — лишь
 * предложение: применяется после подтверждения пользователем.
 */

export interface CategorizeTx {
  id: string;
  description?: string;
  counterparty?: string;
  amount: number;
  mcc?: string;
}

export interface CategorySuggestion {
  transactionId: string;
  categoryId: string;
  categoryName: string;
}

export function buildCategorizePrompt(txs: CategorizeTx[], categoryNames: string[]): string {
  const items = txs.map((t, i) => ({
    n: i + 1,
    текст: `${t.counterparty ?? ''} ${t.description ?? ''}`.trim().slice(0, 120),
    сумма: t.amount,
    ...(t.mcc ? { mcc: t.mcc } : {}),
  }));
  return [
    'Ты помогаешь разложить банковские операции семьи по категориям.',
    `Доступные категории (используй название ТОЧНО как написано): ${JSON.stringify(categoryNames)}`,
    '',
    'ПРАВИЛА:',
    '1. Ответ — только JSON-объект вида {"1": "Категория", "2": "Категория"} без пояснений.',
    '2. Номер — поле n операции. Категория — строго одна из списка.',
    '3. Если не уверен — НЕ включай операцию в ответ. Лучше пропустить, чем угадать.',
    '4. Положительная сумма — поступление, отрицательная — трата.',
    '',
    `ОПЕРАЦИИ: ${JSON.stringify(items)}`,
    '',
    'JSON:',
  ].join('\n');
}

export function parseCategorizeResponse(
  raw: string,
  txs: CategorizeTx[],
  categories: { id: string; name: string }[],
): CategorySuggestion[] {
  const byName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));
  let parsed: unknown;
  try {
    const cleaned = raw.replace(/```json\s*|\s*```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    parsed = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const result: CategorySuggestion[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const idx = Number(key) - 1;
    const tx = txs[idx];
    if (!tx || typeof value !== 'string') continue;
    const cat = byName.get(value.trim().toLowerCase());
    if (!cat) continue; // модель придумала категорию — игнорируем
    result.push({ transactionId: tx.id, categoryId: cat.id, categoryName: cat.name });
  }
  return result;
}
