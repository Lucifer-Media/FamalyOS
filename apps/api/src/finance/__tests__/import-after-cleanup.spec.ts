import { FinanceImportService } from '../finance-import.service';

/**
 * РЕГРЕССИЯ Итерации 4: после «Очистки» (архивирования тестовых операций)
 * та же выписка должна импортироваться заново — ключ дедупликации,
 * указывающий на архивную операцию, не считается дублем.
 */
function makeService(opts: { existingKey?: { transactionEntityId: string }; activeIds: string[]; rules?: any[] }) {
  const prisma = {
    entity: {
      findUnique: jest.fn(async () => ({ id: 'acc', familySpaceId: 'f1', entityType: 'bank_account' })),
      findMany: jest.fn(async ({ where }: any) => {
        if (where.entityType === 'finance_rule') return opts.rules ?? [];
        if (where.id?.in) return where.id.in.filter((id: string) => opts.activeIds.includes(id)).map((id: string) => ({ id }));
        return [];
      }),
    },
    financialTransactionExternalId: {
      findUnique: jest.fn(async () => (opts.existingKey ? { externalId: 'ext-1', ...opts.existingKey } : null)),
      create: jest.fn(async () => undefined),
      update: jest.fn(async () => undefined),
    },
  };
  const permissions = { getMembership: jest.fn(async () => ({})), assertCan: jest.fn(async () => undefined) };
  const audit = { log: jest.fn(async () => undefined) };
  const entities = { create: jest.fn(async (_u: string, _f: string, dto: any) => ({ id: 'new-tx', ...dto })) };
  const service = new FinanceImportService(prisma as any, permissions as any, audit as any, entities as any);
  return { service, prisma, entities };
}

const row = { date: '2026-10-01', amount: -500, currency: 'RUB', description: 'ПЯТЕРОЧКА 77', externalId: 'ext-1', sourceFormat: 'TBANK_CSV' } as any;

describe('Импорт после очистки тестовых операций', () => {
  it('ключ на АКТИВНУЮ операцию — дубль, пропускается', async () => {
    const { service, entities } = makeService({ existingKey: { transactionEntityId: 'old' }, activeIds: ['old'] });
    const res = await service.confirmImport('u', 'f1', 'acc', [row]);
    expect(res).toEqual({ created: 0, skippedDuplicates: 1 });
    expect(entities.create).not.toHaveBeenCalled();
  });

  it('ключ на АРХИВНУЮ операцию — импортируется заново, ключ перенаправляется', async () => {
    const { service, prisma } = makeService({ existingKey: { transactionEntityId: 'old' }, activeIds: [] });
    const res = await service.confirmImport('u', 'f1', 'acc', [row]);
    expect(res.created).toBe(1);
    expect(prisma.financialTransactionExternalId.update).toHaveBeenCalledWith(expect.objectContaining({ data: { transactionEntityId: 'new-tx' } }));
    expect(prisma.financialTransactionExternalId.create).not.toHaveBeenCalled();
  });

  it('правила автокатегоризации применяются при импорте', async () => {
    const { service, entities } = makeService({
      activeIds: [],
      rules: [{ id: 'r', attributes: { name: 'Продукты', conditions: [{ field: 'description', op: 'contains', value: 'пятерочка' }], setCategoryId: 'food', setScope: 'FAMILY' } }],
    });
    await service.confirmImport('u', 'f1', 'acc', [row]);
    const attrs = entities.create.mock.calls[0][2].attributes;
    expect(attrs).toMatchObject({ categoryId: 'food', scope: 'FAMILY', transactionType: 'EXPENSE' });
    expect(entities.create.mock.calls[0][2].changeSummary).toContain('правила: Продукты');
  });
});
