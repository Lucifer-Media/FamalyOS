import { FinanceAutomationService } from '../finance-automation.service';
import { FinanceAiService } from '../finance-ai.service';
import { OllamaService } from '../../ai-assistant/ollama.service';

type Row = { id: string; entityType: string; status: string; attributes: Record<string, unknown>; title?: string };

function makePrisma(rows: Row[]) {
  return {
    entity: {
      findMany: jest.fn(async ({ where }: any) =>
        rows.filter((r) => {
          if (where.entityType && r.entityType !== where.entityType) return false;
          if (where.status && typeof where.status === 'string' && r.status !== where.status) return false;
          if (where.status?.in && !where.status.in.includes(r.status)) return false;
          if (where.id?.in && !where.id.in.includes(r.id)) return false;
          return true;
        }),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        const r = rows.find((x) => x.id === where.id);
        return r ? { ...r, familySpaceId: 'f1', title: r.title ?? r.id } : null;
      }),
    },
    familySpace: { findUnique: jest.fn(async () => ({ baseCurrency: 'RUB' })) },
  };
}

const permissions = { getMembership: jest.fn(async () => ({ role: 'OWNER' })), assertCan: jest.fn(async () => undefined) };
const audit = { log: jest.fn(async () => undefined) };

function makeEntities() {
  return {
    update: jest.fn(async (_u: string, _f: string, id: string, dto: any) => ({ id, ...dto })),
    create: jest.fn(async (_u: string, _f: string, dto: any) => ({ id: 'new-' + dto.entityType, ...dto })),
    setStatus: jest.fn(async () => undefined),
    findOne: jest.fn(),
  };
}

const tx = (id: string, attrs: Record<string, unknown>): Row => ({ id, entityType: 'financial_transaction', status: 'ACTIVE', attributes: attrs });

describe('FinanceAutomationService — правила к существующим операциям', () => {
  const rows: Row[] = [
    tx('t1', { date: '2026-10-01', amount: -500, description: 'ПЯТЁРОЧКА 123' }),
    tx('t2', { date: '2026-10-02', amount: -700, description: 'Пятерочка', categoryId: 'manual' }),
    tx('t3', { date: '2026-10-03', amount: -100, description: 'Аптека' }),
    { id: 'r1', entityType: 'finance_rule', status: 'ACTIVE', attributes: { name: 'Продукты', conditions: [{ field: 'description', op: 'contains', value: 'пятерочка' }], setCategoryId: 'food' } },
  ];

  it('предпросмотр ничего не меняет и не трогает операции с ручной категорией', async () => {
    const entities = makeEntities();
    const s = new FinanceAutomationService(makePrisma(rows) as any, permissions as any, audit as any, entities as any);
    const res = await s.applyRulesToExisting('u', 'f1', { dryRun: true });
    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ transactionId: 't1', changes: { categoryId: 'food' }, rules: ['Продукты'] });
    expect(entities.update).not.toHaveBeenCalled();
  });

  it('применение идёт через EntitiesService.update (версии + аудит), с указанием правила', async () => {
    const entities = makeEntities();
    const s = new FinanceAutomationService(makePrisma(rows) as any, permissions as any, audit as any, entities as any);
    await s.applyRulesToExisting('u', 'f1', { dryRun: false });
    expect(entities.update).toHaveBeenCalledWith('u', 'f1', 't1', { attributes: { categoryId: 'food' }, changeSummary: 'Правило: Продукты' });
    expect(permissions.assertCan).toHaveBeenCalledWith(expect.anything(), 'FINANCE', 'EDIT');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'finance.rules_applied' }));
  });

  it('сохранение некорректного правила отклоняется понятной ошибкой', async () => {
    const s = new FinanceAutomationService(makePrisma([]) as any, permissions as any, audit as any, makeEntities() as any);
    await expect(s.saveRule('u', 'f1', { attributes: { name: 'Пустое', conditions: [] } })).rejects.toThrow('Правило заполнено не полностью');
  });
});

describe('FinanceAutomationService — очистка тестовых операций', () => {
  const rows: Row[] = [
    tx('a', { date: '2026-09-01', amount: -1, accountId: 'acc1', source: 'MANUAL' }),
    tx('b', { date: '2026-09-02', amount: -2, accountId: 'acc1', source: 'IMPORT' }),
    tx('c', { date: '2026-09-03', amount: -3, accountId: 'acc2', source: 'IMPORT' }),
  ];

  it('без фильтра и без явного «все» — отказ', async () => {
    const s = new FinanceAutomationService(makePrisma(rows) as any, permissions as any, audit as any, makeEntities() as any);
    await expect(s.cleanupPreview('u', 'f1', {})).rejects.toThrow('явно выберите');
  });

  it('архивирует ровно предпросмотренный набор, физически ничего не удаляет', async () => {
    const entities = makeEntities();
    const s = new FinanceAutomationService(makePrisma(rows) as any, permissions as any, audit as any, entities as any);
    const preview = await s.cleanupPreview('u', 'f1', { accountId: 'acc1' });
    expect(preview.count).toBe(2);
    await s.cleanupArchive('u', 'f1', { accountId: 'acc1', confirmCount: 2 });
    expect(entities.setStatus).toHaveBeenCalledTimes(2);
    expect(entities.setStatus).toHaveBeenCalledWith('u', 'f1', 'a', 'ARCHIVED', 'Очистка тестовых операций');
    expect(permissions.assertCan).toHaveBeenCalledWith(expect.anything(), 'FINANCE', 'ARCHIVE');
  });

  it('если набор изменился после предпросмотра — не архивирует', async () => {
    const entities = makeEntities();
    const s = new FinanceAutomationService(makePrisma(rows) as any, permissions as any, audit as any, entities as any);
    await expect(s.cleanupArchive('u', 'f1', { all: true, confirmCount: 2 })).rejects.toThrow('Набор операций изменился');
    expect(entities.setStatus).not.toHaveBeenCalled();
  });
});

describe('FinanceAiService — отчёты', () => {
  const rows: Row[] = [
    tx('1', { date: '2026-10-05', amount: 100000, currency: 'RUB', description: 'Зарплата' }),
    tx('2', { date: '2026-10-06', amount: -20000, currency: 'RUB', description: 'Продукты', categoryId: 'food' }),
    tx('3', { date: '2026-10-06', amount: -50, currency: 'USD', description: 'Steam' }),
    tx('4', { date: '2026-10-07', amount: -9999, currency: 'RUB', isPlanned: true, plannedStatus: 'PLANNED' }),
    { id: 'food', entityType: 'financial_category', status: 'ACTIVE', attributes: { name: 'Продукты' } },
  ];
  const portfolio = { getNetWorth: jest.fn(async () => ({ netWorth: 500000 })) };

  function makeAi(llm: Partial<OllamaService>) {
    const prisma = makePrisma(rows);
    const entities = makeEntities();
    const automation = new FinanceAutomationService(prisma as any, permissions as any, audit as any, entities as any);
    const ai = new FinanceAiService(prisma as any, permissions as any, audit as any, entities as any, llm as any, automation, portfolio as any);
    return { ai, entities };
  }

  it('факты считаются кодом: плановые и другая валюта не попадают, предупреждение о валюте', async () => {
    const { ai } = makeAi({ isConfigured: () => false });
    const { facts, otherCurrencyCount } = await ai.buildFacts('u', 'f1', '2026-10-01', '2026-10-31');
    expect(facts).toMatchObject({ income: 100000, expense: 20000, net: 80000, netWorth: 500000 });
    expect(otherCurrencyCount).toBe(1);
  });

  it('без настроенной LLM отчёт сразу готов по шаблону', async () => {
    const { ai, entities } = makeAi({ isConfigured: () => false });
    await ai.createReport('u', 'f1', { periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    const created = entities.create.mock.calls[0][2];
    expect(created.attributes).toMatchObject({ reportStatus: 'READY', generator: 'TEMPLATE' });
    expect(created.attributes.narrative).toContain('## Главное');
  });

  it('с LLM: фоновая генерация, модель указана, выдуманные числа — в предупреждениях', async () => {
    const complete = jest.fn(async () => ({ text: '## Главное\nДоход 100 000 ₽, расходы 20 000 ₽, а на такси 55 555 ₽.', endpoint: { role: 'fallback', url: 'http://host.docker.internal:11434', provider: 'ollama', model: 'qwen3:8b' }, durationMs: 10 }));
    const { ai, entities } = makeAi({ isConfigured: () => true, complete } as any);
    await ai.createReport('u', 'f1', { periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    expect(entities.create.mock.calls[0][2].attributes.reportStatus).toBe('GENERATING');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const update = entities.update.mock.calls[0][3];
    expect(update.attributes).toMatchObject({ reportStatus: 'READY', generator: 'AI', unverifiedNumbers: ['55 555'] });
    expect(update.attributes.modelUsed).toContain('qwen3:8b (резервная');
  });

  it('если модель не ответила — шаблон и предупреждение, отчёт не «висит»', async () => {
    const { ai, entities } = makeAi({ isConfigured: () => true, complete: jest.fn(async () => null) } as any);
    await ai.createReport('u', 'f1', { periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(entities.update.mock.calls[0][3].attributes).toMatchObject({ reportStatus: 'READY', generator: 'TEMPLATE' });
  });

  it('неверный период — понятная ошибка', async () => {
    const { ai } = makeAi({ isConfigured: () => false });
    await expect(ai.buildFacts('u', 'f1', '2026-10-31', '2026-10-01')).rejects.toThrow('Период задан неверно');
  });
});

describe('OllamaService — цепочка ПК (LM Studio) → ноутбук (Ollama)', () => {
  const ORIGINAL_ENV = process.env;
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it('у резервного адреса свой тип API и своя модель', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      LLM_PROVIDER: 'openai_compatible',
      LLM_URL: 'http://pc:1234',
      LLM_MODEL: 'qwen/qwen3.6-35b-a3b',
      LLM_FALLBACK_URL: 'http://host.docker.internal:11434',
      LLM_FALLBACK_PROVIDER: 'ollama',
      LLM_FALLBACK_MODEL: 'qwen3:8b',
    };
    const calls: { url: string; body: any }[] = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      if (String(url).startsWith('http://pc')) throw new Error('ECONNREFUSED');
      return { ok: true, json: async () => ({ response: '<think>хм</think>Ответ ноутбука' }) } as any;
    }) as any;
    const s = new OllamaService();
    const res = await s.complete('привет');
    expect(calls[0].url).toBe('http://pc:1234/v1/chat/completions');
    expect(calls[1]).toMatchObject({ url: 'http://host.docker.internal:11434/api/generate', body: { model: 'qwen3:8b' } });
    expect(res).toMatchObject({ text: 'Ответ ноутбука', endpoint: { role: 'fallback', provider: 'ollama' } });
  });

  it('status() проверяет каждый адрес и наличие модели', async () => {
    process.env = { ...ORIGINAL_ENV, LLM_PROVIDER: 'ollama', LLM_URL: 'http://lap:11434', LLM_MODEL: 'qwen3:8b', LLM_FALLBACK_URL: '' , OLLAMA_FALLBACK_URL: '' };
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ models: [{ name: 'qwen3:8b' }] }) })) as any;
    const st = await new OllamaService().status();
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ reachable: true, modelAvailable: true, url: 'http://lap:11434' });
  });
});
