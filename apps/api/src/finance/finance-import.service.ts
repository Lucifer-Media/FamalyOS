import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { AuditService } from '../audit/audit.service';
import { EntitiesService } from '../entities/entities.service';
import { parseBankStatementText, parseBankStatementRows, ParsedTransaction } from './bank-statement-parser';
import { findReconciliationCandidates, ReconciliationTransaction, findTransferPairMatch } from './reconciliation';
import { matchCategoryByName } from './category-matcher';

export interface StagedTransaction extends ParsedTransaction {
  isDuplicate: boolean;
  existingTransactionId?: string;
  /** Найденная по названию ссылка на справочник категорий — undefined, если не удалось сопоставить (см. category-matcher.ts). */
  categoryId?: string;
}

@Injectable()
export class FinanceImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly entities: EntitiesService,
  ) {}

  async parseFile(
    userId: string,
    familySpaceId: string,
    accountEntityId: string,
    filename: string,
    mimeType: string,
    buffer: Buffer,
  ): Promise<{ detectedFormat: string; warnings: string[]; transactions: StagedTransaction[] }> {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'DOCUMENTS', 'CREATE');

    const account = await this.prisma.entity.findUnique({ where: { id: accountEntityId } });
    if (!account || account.familySpaceId !== familySpaceId || account.entityType !== 'bank_account') {
      throw new BadRequestException('Счёт не найден в этом пространстве');
    }

    let result;
    const isXlsx =
      mimeType.includes('spreadsheetml') ||
      filename.toLowerCase().endsWith('.xlsx') ||
      filename.toLowerCase().endsWith('.xls');
    if (isXlsx) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const XLSX = require('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      result = parseBankStatementRows(rows);
    } else {
      result = parseBankStatementText(buffer.toString('utf8'), filename);
    }

    if (result.transactions.length === 0) {
      return { detectedFormat: result.detectedFormat, warnings: result.warnings, transactions: [] };
    }

    const externalIds = result.transactions.map((t) => t.externalId);
    const existing = await this.prisma.financialTransactionExternalId.findMany({
      where: { accountEntityId, externalId: { in: externalIds } },
    });
    const existingByExternalId = new Map<string, string>(
      existing.map((e: { externalId: string; transactionEntityId: string }) => [e.externalId, e.transactionEntityId]),
    );

    // Пытаемся сопоставить текстовую категорию из выписки со справочником —
    // консервативно, только точное совпадение (см. category-matcher.ts).
    // Не сопоставленное — не блокирует импорт, просто останется без
    // категории, фронтенд подсветит это в предпросмотре.
    const categories = await this.prisma.entity.findMany({
      where: { familySpaceId, entityType: 'financial_category' },
      select: { id: true, attributes: true },
    });
    const categoryOptions = categories.map((c: { id: string; attributes: unknown }) => ({
      id: c.id,
      name: String((c.attributes as Record<string, unknown>).name ?? ''),
    }));

    const staged: StagedTransaction[] = result.transactions.map((t) => ({
      ...t,
      isDuplicate: existingByExternalId.has(t.externalId),
      existingTransactionId: existingByExternalId.get(t.externalId),
      categoryId: matchCategoryByName(t.category, categoryOptions),
    }));

    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'finance.import_parsed',
      resourceType: 'bank_account',
      resourceId: accountEntityId,
      metadata: {
        filename,
        detectedFormat: result.detectedFormat,
        total: staged.length,
        duplicates: staged.filter((t) => t.isDuplicate).length,
      },
    });

    return { detectedFormat: result.detectedFormat, warnings: result.warnings, transactions: staged };
  }

  async confirmImport(
    userId: string,
    familySpaceId: string,
    accountEntityId: string,
    transactions: (ParsedTransaction & { categoryId?: string })[],
  ): Promise<{ created: number; skippedDuplicates: number }> {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'DOCUMENTS', 'CREATE');

    const account = await this.prisma.entity.findUnique({ where: { id: accountEntityId } });
    if (!account || account.familySpaceId !== familySpaceId || account.entityType !== 'bank_account') {
      throw new BadRequestException('Счёт не найден в этом пространстве');
    }

    let created = 0;
    let skippedDuplicates = 0;
    const createdEntities: { id: string; date: string; amount: number; description: string }[] = [];

    for (const t of transactions) {
      const existing = await this.prisma.financialTransactionExternalId.findUnique({
        where: { accountEntityId_externalId: { accountEntityId, externalId: t.externalId } },
      });
      if (existing) {
        skippedDuplicates++;
        continue;
      }

      const entity = await this.entities.create(userId, familySpaceId, {
        entityType: 'financial_transaction',
        title: `${t.date}: ${t.description}`,
        attributes: {
          date: t.date,
          amount: t.amount,
          currency: t.currency,
          accountId: accountEntityId,
          description: t.description,
          category: t.category,
          categoryId: t.categoryId || undefined,
          counterparty: t.counterparty,
          transactionType: t.amount < 0 ? 'EXPENSE' : 'INCOME',
          source: 'IMPORT',
          externalId: t.externalId,
        },
        changeSummary: `Импортировано из выписки (${t.sourceFormat})`,
      });

      await this.prisma.financialTransactionExternalId.create({
        data: { familySpaceId, accountEntityId, externalId: t.externalId, transactionEntityId: entity.id },
      });
      created++;
      createdEntities.push({ id: entity.id, date: t.date, amount: t.amount, description: t.description });
    }

    // "Мапинг переводов между счетами" — если операция похожа на перевод
    // между своими счетами (по описанию), ищем в ДРУГИХ счетах этого же
    // пространства операцию с противоположной суммой близко по дате и
    // связываем их как пару перевода. Работает и для только что
    // импортированных операций, и для уже существующих в других счетах.
    const transferKeywords = /между своими счетами|перевод между собственными счетами|между собственными счетами/i;
    for (const tx of createdEntities) {
      if (!transferKeywords.test(tx.description)) continue;
      await this.tryLinkTransferPair(userId, familySpaceId, accountEntityId, tx);
    }

    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'finance.import_confirmed',
      resourceType: 'bank_account',
      resourceId: accountEntityId,
      metadata: { created, skippedDuplicates },
    });

    return { created, skippedDuplicates };
  }

  /**
   * Ищет в ДРУГИХ счетах этого пространства операцию-пару для перевода
   * (противоположная сумма, дата в пределах 3 дней, ещё не связана) и, если
   * находит, помечает обе операции как TRANSFER со взаимной ссылкой.
   * Не создаёт ничего нового — только связывает уже существующие записи.
   */
  private async tryLinkTransferPair(
    userId: string,
    familySpaceId: string,
    excludeAccountId: string,
    tx: { id: string; date: string; amount: number },
  ): Promise<void> {
    const candidates = await this.prisma.entity.findMany({
      where: { familySpaceId, entityType: 'financial_transaction', status: 'ACTIVE', id: { not: tx.id } },
      select: { id: true, attributes: true },
    });

    const match = findTransferPairMatch(excludeAccountId, tx, candidates);
    if (!match) return;

    await this.entities.update(userId, familySpaceId, tx.id, {
      attributes: { transactionType: 'TRANSFER', relatedTransactionId: match },
      changeSummary: 'Автоматически связано как перевод между своими счетами',
    });
    await this.entities.update(userId, familySpaceId, match, {
      attributes: { transactionType: 'TRANSFER', relatedTransactionId: tx.id },
      changeSummary: 'Автоматически связано как перевод между своими счетами',
    });
  }

  async findReconciliationCandidatesForDocument(userId: string, familySpaceId: string, documentEntityId: string) {
    await this.permissions.getMembership(userId, familySpaceId);
    const doc = await this.prisma.entity.findUnique({ where: { id: documentEntityId } });
    if (!doc || doc.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Документ не найден');
    }
    const attrs = doc.attributes as Record<string, unknown>;
    const amount = (attrs.totalAmount ?? attrs.amount) as number | undefined;
    const dateHint = (attrs.dueDate ?? attrs.date ?? doc.createdAt.toISOString().slice(0, 10)) as string;
    if (amount == null) {
      return { candidates: [], reason: 'У документа не указана сумма — сверка невозможна' };
    }

    const transactions = await this.prisma.entity.findMany({
      where: { familySpaceId, entityType: 'financial_transaction', status: 'ACTIVE' },
      select: { id: true, attributes: true },
      take: 5000,
    });

    const reconciliationInput: ReconciliationTransaction[] = transactions
      .map((t: { id: string; attributes: unknown }) => {
        const a = t.attributes as Record<string, unknown>;
        return { id: t.id, date: String(a.date ?? ''), amount: Number(a.amount ?? 0) };
      })
      .filter((t: ReconciliationTransaction) => t.date);

    const candidates = findReconciliationCandidates(amount, dateHint, reconciliationInput);
    return { candidates };
  }

  async linkDocumentToTransaction(
    userId: string,
    familySpaceId: string,
    documentEntityId: string,
    transactionEntityId: string,
  ) {
    await this.permissions.getMembership(userId, familySpaceId);
    const [doc, tx] = await Promise.all([
      this.prisma.entity.findUnique({ where: { id: documentEntityId } }),
      this.prisma.entity.findUnique({ where: { id: transactionEntityId } }),
    ]);
    if (!doc || doc.familySpaceId !== familySpaceId || !tx || tx.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Документ или операция не найдены');
    }
    await this.prisma.entityLink.create({
      data: {
        sourceEntityId: documentEntityId,
        targetEntityId: transactionEntityId,
        linkType: 'reconciled_with_transaction',
        createdByUserId: userId,
      },
    });
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'finance.reconciliation_linked',
      resourceType: doc.entityType,
      resourceId: documentEntityId,
      metadata: { transactionEntityId },
    });
    return { success: true };
  }
}
