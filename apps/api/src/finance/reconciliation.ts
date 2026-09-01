/**
 * Сверка (reconciliation) документа с денежной суммой (квитанция ЖКХ, чек,
 * счёт) и банковских операций — раздел 25 ТЗ: "если в квитанции ЖКХ одна
 * сумма и в операции из банка такая же сумма — документ и операцию нужно
 * связать". Это ТОЛЬКО предложение связи (кандидаты), не автоматическое
 * создание её без участия пользователя — тот же принцип, что и везде в
 * системе: не связывать данные молча.
 */

export interface ReconciliationCandidate {
  transactionId: string;
  transactionDate: string;
  transactionAmount: number;
  daysDifference: number;
  amountMatchType: 'exact' | 'rounded'; // 'rounded' — совпадение до копеек могло потеряться при OCR
  confidence: number;
}

export interface ReconciliationTransaction {
  id: string;
  date: string; // ISO
  amount: number; // отрицательное — расход
}

/**
 * Ищет операции, сумма которых (по модулю — квитанция ЖКХ хранится как
 * положительное число "к оплате", банковская операция расхода — как
 * отрицательное) совпадает с суммой документа, в пределах допустимого окна
 * дат (обычно оплата происходит в течение нескольких дней после выставления
 * квитанции, но может быть и заранее — автоплатёж).
 */
export function findReconciliationCandidates(
  documentAmount: number,
  documentDate: string,
  transactions: ReconciliationTransaction[],
  options: { maxDaysDifference?: number; amountTolerance?: number } = {},
): ReconciliationCandidate[] {
  const maxDays = options.maxDaysDifference ?? 20;
  const tolerance = options.amountTolerance ?? 0.01;
  const docDateMs = new Date(documentDate).getTime();
  const targetAbsAmount = Math.abs(documentAmount);

  const candidates: ReconciliationCandidate[] = [];

  for (const tx of transactions) {
    const txAbsAmount = Math.abs(tx.amount);
    const amountDiff = Math.abs(txAbsAmount - targetAbsAmount);
    if (amountDiff > tolerance && amountDiff > targetAbsAmount * 0.001) continue; // не совпадает по сумме

    const txDateMs = new Date(tx.date).getTime();
    const daysDifference = Math.round(Math.abs(txDateMs - docDateMs) / 86400000);
    if (daysDifference > maxDays) continue;

    // Уверенность выше для точного совпадения суммы и близкой даты — но это
    // не более чем ранжирование кандидатов для пользователя, не автопривязка.
    const dateScore = Math.max(0, 1 - daysDifference / maxDays);
    const amountScore = amountDiff < 0.005 ? 1 : 0.85;
    const confidence = Math.round((0.6 * amountScore + 0.4 * dateScore) * 100) / 100;

    candidates.push({
      transactionId: tx.id,
      transactionDate: tx.date,
      transactionAmount: tx.amount,
      daysDifference,
      amountMatchType: amountDiff < 0.005 ? 'exact' : 'rounded',
      confidence,
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Чистая функция поиска парной операции для перевода между своими счетами —
 * вынесена отдельно от FinanceImportService, чтобы тестироваться без
 * реальных Prisma-зависимостей (см. finance-import.service.ts).
 */
export function findTransferPairMatch(
  excludeAccountId: string,
  tx: { id: string; date: string; amount: number },
  candidates: { id: string; attributes: unknown }[],
): string | undefined {
  const txDateMs = new Date(tx.date).getTime();
  const match = candidates.find((c) => {
    const a = c.attributes as Record<string, unknown>;
    if (a.accountId === excludeAccountId) return false; // тот же счёт — не может быть парой перевода
    if (a.relatedTransactionId) return false; // уже связана с другой операцией
    const amount = Number(a.amount);
    if (Math.abs(amount + tx.amount) > 0.01) return false; // суммы должны быть противоположны
    const date = String(a.date ?? '');
    if (!date) return false;
    const daysDiff = Math.abs(new Date(date).getTime() - txDateMs) / 86400000;
    return daysDiff <= 3;
  });
  return match?.id;
}
