import { TelegramBotService } from '../telegram-bot.service';
import { TelegramClient, TgUpdate } from '../telegram-api';
import { matchAccountInText, resolveAccountInText } from '../telegram-parser';

const CHAT = -5373163824;

function fakeClient() {
  const sent: { chatId: any; text: string; keyboard?: any }[] = [];
  const edits: { text: string; keyboard?: any }[] = [];
  const answers: (string | undefined)[] = [];
  const client: TelegramClient = {
    getMe: async () => ({ id: 1, username: 'family_os_bot' }),
    getUpdates: async () => [],
    sendMessage: async (chatId, text, keyboard) => {
      sent.push({ chatId, text, keyboard });
      return { message_id: 900 + sent.length, chat: { id: Number(chatId), type: 'group' }, date: 0, text };
    },
    editMessage: async (_c, _m, text, keyboard) => {
      edits.push({ text, keyboard });
    },
    answerCallback: async (_id, text) => {
      answers.push(text);
    },
    setMyCommands: async () => undefined,
    deleteWebhook: async () => undefined,
  };
  return { client, sent, edits, answers };
}

function setup(opts: { linked?: boolean; budgetPercent?: number; alertSent?: boolean } = {}) {
  const entities: any[] = [
    { id: 'acc-t', familySpaceId: 'fs', entityType: 'bank_account', status: 'ACTIVE', title: 'Т-Банк Максим', attributes: { accountName: 'Т-Банк Максим', currency: 'RUB' } },
    { id: 'acc-a', familySpaceId: 'fs', entityType: 'bank_account', status: 'ACTIVE', title: 'Альфа Арина', attributes: { accountName: 'Альфа Арина', currency: 'RUB' } },
    { id: 'cat-cafe', familySpaceId: 'fs', entityType: 'financial_category', status: 'ACTIVE', title: 'Кафе', attributes: { name: 'Кафе', categoryType: 'EXPENSE' } },
    { id: 'cat-med', familySpaceId: 'fs', entityType: 'financial_category', status: 'ACTIVE', title: 'Медицина', attributes: { name: 'Медицина', categoryType: 'EXPENSE' } },
    { id: 'b1', familySpaceId: 'fs', entityType: 'budget', status: 'ACTIVE', title: 'Кафе', attributes: { startDate: '2020-01-01', alertThresholdPercent: 80 } },
  ];
  if (opts.linked)
    entities.push({ id: 'link1', familySpaceId: 'fs', entityType: 'telegram_link', status: 'ACTIVE', title: 'tg', attributes: { telegramUserId: '111', chatId: String(CHAT), userId: 'u-max', defaultAccountId: 'acc-t', notifyBudgets: true } });
  const extIds = new Set<string>();
  const prisma: any = {
    entity: {
      findFirst: jest.fn(async ({ where }: any) => entities.find((e) => e.entityType === where.entityType && e.status === where.status && e.attributes.telegramUserId === where.attributes.equals) ?? null),
      findMany: jest.fn(async ({ where }: any) => entities.filter((e) => (!where.entityType || e.entityType === where.entityType) && (!where.status || e.status === where.status) && (!where.id?.in || where.id.in.includes(e.id)))),
      findUnique: jest.fn(async ({ where }: any) => entities.find((e) => e.id === where.id) ?? null),
    },
    financialTransactionExternalId: {
      findUnique: jest.fn(async ({ where }: any) => (extIds.has(where.accountEntityId_externalId.externalId) ? { id: 'x' } : null)),
      create: jest.fn(async ({ data }: any) => extIds.add(data.externalId)),
    },
    auditLog: { findFirst: jest.fn(async () => (opts.alertSent ? { id: 'a' } : null)) },
    person: { findMany: jest.fn(async () => [{ id: 'p-max', fullName: 'Максим' }, { id: 'p-arina', fullName: 'Арина' }]) },
    membership: { findUnique: jest.fn(async () => ({ personId: 'p-max' })) },
  };
  const audit = { log: jest.fn(async () => undefined) };
  let n = 0;
  const entitiesSvc = {
    create: jest.fn(async (_u: string, fs: string, dto: any) => {
      const e = { id: `new-${++n}`, familySpaceId: fs, status: 'ACTIVE', title: dto.title, entityType: dto.entityType, attributes: dto.attributes };
      entities.push(e);
      return e;
    }),
    update: jest.fn(async (_u: string, _f: string, id: string, dto: any) => {
      const e = entities.find((x) => x.id === id);
      Object.assign(e.attributes, dto.attributes);
      return e;
    }),
    setStatus: jest.fn(async (_u: string, _f: string, id: string, status: string) => {
      entities.find((x) => x.id === id).status = status;
    }),
  };
  const llm = { isConfigured: () => false, complete: jest.fn() };
  const automation = {
    loadActiveTransactions: async () => entities.filter((e) => e.entityType === 'financial_transaction' && e.status === 'ACTIVE').map((e) => ({ id: e.id, attributes: e.attributes })),
    loadRules: async () => [],
  };
  const analytics = { getBudgetStatus: jest.fn(async () => ({ plannedExpense: 10000, spent: (opts.budgetPercent ?? 10) * 100, remaining: 10000 - (opts.budgetPercent ?? 10) * 100, percentUsed: opts.budgetPercent ?? 10 })) };
  const svc = new TelegramBotService(prisma, audit as any, entitiesSvc as any, llm as any, automation as any, {} as any, {} as any, analytics as any, {} as any);
  (svc as any).allowedChats = new Set([String(CHAT)]);
  const tg = fakeClient();
  svc.useClient(tg.client);
  return { svc, tg, entities, entitiesSvc, audit, prisma };
}

const msg = (text: string, fromId = 111, chatId = CHAT, messageId = 10): TgUpdate => ({
  update_id: messageId,
  message: { message_id: messageId, from: { id: fromId, username: 'maxim' }, chat: { id: chatId, type: 'group' }, text, date: 0 },
});

describe('Telegram-бот', () => {
  it('в неразрешённом чате только подсказывает ID чата', async () => {
    const { svc, tg, entitiesSvc } = setup();
    await svc.handleUpdate(msg('350 кофе', 111, 12345));
    expect(tg.sent[0].text).toContain('12345');
    expect(entitiesSvc.create).not.toHaveBeenCalled();
  });

  it('РЕГРЕССИЯ: в неразрешённом чате команды после первого предупреждения не уходят в тишину', async () => {
    const { svc, tg, entitiesSvc } = setup();
    await svc.handleUpdate(msg('привет', 111, 429043619));
    expect(tg.sent).toHaveLength(1);
    await svc.handleUpdate(msg('ещё текст', 111, 429043619, 11));
    expect(tg.sent).toHaveLength(1); // обычный текст — не спамим
    (svc as any).warnedChats.set('429043619', Date.now() - 31000);
    await svc.handleUpdate(msg('/link 335830', 111, 429043619, 12));
    expect(tg.sent).toHaveLength(2);
    expect(tg.sent[1].text).toContain('429043619');
    expect(entitiesSvc.create).not.toHaveBeenCalled();
  });

  it('без привязки ничего не записывает и просит /link', async () => {
    const { svc, tg, entitiesSvc } = setup();
    await svc.handleUpdate(msg('350 кофе'));
    expect(tg.sent[0].text).toContain('/link');
    expect(entitiesSvc.create).not.toHaveBeenCalled();
  });

  it('привязка по одноразовому коду; чужой/старый код не подходит', async () => {
    const { svc, tg, entitiesSvc } = setup();
    await svc.handleUpdate(msg('/link 000000'));
    expect(tg.sent[0].text).toContain('истёк');
    const { code } = svc.createLinkCode('u-max', 'fs');
    await svc.handleUpdate(msg(`/link ${code}`));
    expect(entitiesSvc.create).toHaveBeenCalledWith('u-max', 'fs', expect.objectContaining({ entityType: 'telegram_link', attributes: expect.objectContaining({ telegramUserId: '111', chatId: String(CHAT) }) }));
    await svc.handleUpdate(msg(`/link ${code}`));
    expect(tg.sent[2].text).toContain('истёк'); // код одноразовый
  });

  it('запись траты: от имени привязанного пользователя, категория по словам, кнопки', async () => {
    const { svc, tg, entitiesSvc } = setup({ linked: true });
    await svc.handleUpdate(msg('350 кофе'));
    const call: any = entitiesSvc.create.mock.calls.find((c: any[]) => c[2].entityType === 'financial_transaction');
    expect(call[0]).toBe('u-max');
    expect(call[2].attributes).toMatchObject({ amount: -350, accountId: 'acc-t', categoryId: 'cat-cafe', scope: 'FAMILY', source: 'MANUAL' });
    expect(tg.sent[0].text).toContain('Кафе');
    expect(tg.sent[0].keyboard[0].map((b: any) => b.text)).toEqual(['📂 Категория', '👤 Сделать личным', '↩️ Отменить']);
  });

  it('наименование счёта в сообщении выбирает счёт', async () => {
    const { svc, entitiesSvc } = setup({ linked: true });
    await svc.handleUpdate(msg('стоматолог 4500 альфа'));
    const tx: any = (entitiesSvc.create.mock.calls.find((c: any[]) => c[2].entityType === 'financial_transaction') as any)[2];
    expect(tx.attributes).toMatchObject({ accountId: 'acc-a', description: 'стоматолог', categoryId: 'cat-med' });
  });

  it('повторная доставка того же сообщения не задваивает операцию', async () => {
    const { svc, entitiesSvc } = setup({ linked: true });
    await svc.handleUpdate(msg('350 кофе'));
    await svc.handleUpdate(msg('350 кофе'));
    expect(entitiesSvc.create.mock.calls.filter((c: any[]) => c[2].entityType === 'financial_transaction')).toHaveLength(1);
  });

  it('кнопка «Отменить» архивирует; чужая кнопка не срабатывает', async () => {
    const { svc, tg, entitiesSvc } = setup({ linked: true });
    await svc.handleUpdate(msg('350 кофе'));
    const undo = tg.sent[0].keyboard[0][2].callback_data;
    await svc.handleUpdate({ update_id: 99, callback_query: { id: 'q1', from: { id: 222 }, message: { message_id: 901, chat: { id: CHAT, type: 'group' }, date: 0 }, data: undo } });
    expect(tg.answers[0]).toContain('другого участника');
    await svc.handleUpdate({ update_id: 100, callback_query: { id: 'q2', from: { id: 111 }, message: { message_id: 901, chat: { id: CHAT, type: 'group' }, date: 0 }, data: undo } });
    expect(entitiesSvc.setStatus).toHaveBeenCalledWith('u-max', 'fs', 'new-1', 'ARCHIVED', 'Отменено в Telegram');
  });

  it('уведомление о бюджете на пороге — один раз, с записью в журнал', async () => {
    const { svc, tg, audit } = setup({ linked: true, budgetPercent: 85 });
    const link = (await svc.findLink(111))!;
    await svc.checkBudgets(link);
    expect(tg.sent.find((s) => s.text.includes('Бюджет «Кафе»: 85%'))).toBeTruthy();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'telegram.budget_alert', metadata: expect.objectContaining({ level: 80 }) }));

    const again = setup({ linked: true, budgetPercent: 85, alertSent: true });
    await again.svc.checkBudgets((await again.svc.findLink(111))!);
    expect(again.tg.sent).toHaveLength(0);
  });

  it('превышение бюджета — отдельное уведомление', async () => {
    const { svc, tg } = setup({ linked: true, budgetPercent: 120 });
    await svc.checkBudgets((await svc.findLink(111))!);
    expect(tg.sent[0].text).toContain('превышен');
  });
});

describe('Счёт по наименованию, банку и владельцу', () => {
  const accs = [
    { id: 'fam-a', name: 'Семейный счёт', bankName: 'Альфа-Банк', isShared: true },
    { id: 'fam-t', name: 'Семейный счёт', bankName: 'Т-Банк', isShared: true },
    { id: 'main-m', name: 'Основной', bankName: 'Т-Банк', ownerPersonId: 'p-max', ownerName: 'Максим' },
    { id: 'main-a', name: 'Основной', bankName: 'Альфа-Банк', ownerPersonId: 'p-arina', ownerName: 'Арина' },
  ];
  it('«семейный счёт альфа» и «семейный счет тиньк» различаются банком', () => {
    expect(resolveAccountInText('продукты 2000 семейный счёт альфа', accs, 'p-max')).toEqual({ accountId: 'fam-a', text: 'продукты 2000' });
    expect(resolveAccountInText('семейный счет тиньк 1500 аптека', accs, 'p-max')).toEqual({ accountId: 'fam-t', text: '1500 аптека' });
  });
  it('«основной» — счёт того, кто пишет; «основной арина» — счёт Арины', () => {
    expect(resolveAccountInText('кофе 300 основной', accs, 'p-max').accountId).toBe('main-m');
    expect(resolveAccountInText('кофе 300 основной', accs, 'p-arina').accountId).toBe('main-a');
    expect(resolveAccountInText('кофе 300 основной арина', accs, 'p-max').accountId).toBe('main-a');
  });
  it('«семейный счёт» без банка — спросить; просто «семейный» — это тип расхода', () => {
    expect(resolveAccountInText('продукты 2000 семейный счёт', accs, 'p-max').ambiguous).toEqual(['fam-a', 'fam-t']);
    expect(resolveAccountInText('продукты 2000 семейный', accs, 'p-max')).toEqual({ text: 'продукты 2000 семейный' });
  });
});

describe('Бот: баланс без ИИ и копейки', () => {
  it('РЕГРЕССИЯ: «/ask баланс по семейному счёту альфа» — точный баланс с копейками, без модели', async () => {
    const { svc, tg, entities } = setup({ linked: true });
    Object.assign(entities.find((e: any) => e.id === 'acc-a').attributes, { accountName: 'Семейный', bankName: 'Альфа Банк', currentBalance: 378.45 });
    await svc.handleUpdate(msg('/ask напиши текущие баланс по семейному счета альфа'));
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0].text).toContain('378,45 ₽');
    expect(tg.sent[0].text).not.toContain('378 450');
  });
});

describe('Бот: неоднозначный счёт', () => {
  it('спрашивает кнопками только среди подходящих счетов и записывает выбранный', async () => {
    const { svc, tg, entities, entitiesSvc } = setup({ linked: true });
    entities.find((e: any) => e.id === 'acc-t').attributes.accountName = 'Семейный счёт';
    entities.find((e: any) => e.id === 'acc-t').attributes.bankName = 'Т-Банк';
    entities.find((e: any) => e.id === 'acc-a').attributes.accountName = 'Семейный счёт';
    entities.find((e: any) => e.id === 'acc-a').attributes.bankName = 'Альфа-Банк';
    await svc.handleUpdate(msg('продукты 2000 семейный счёт'));
    const kb = tg.sent[0].keyboard;
    expect(kb.map((r: any) => r[0].text)).toEqual(['Семейный счёт · Т-Банк', 'Семейный счёт · Альфа-Банк']);
    await svc.handleUpdate({ update_id: 5, callback_query: { id: 'q', from: { id: 111 }, message: { message_id: 901, chat: { id: CHAT, type: 'group' }, date: 0 }, data: kb[1][0].callback_data } });
    const tx: any = (entitiesSvc.create.mock.calls.find((c: any[]) => c[2].entityType === 'financial_transaction') as any)[2];
    expect(tx.attributes).toMatchObject({ accountId: 'acc-a', amount: -2000, description: 'продукты' });
  });
});

describe('Счёт по наименованию', () => {
  const accs = [
    { id: 't1', name: 'Т-Банк Максим' },
    { id: 't2', name: 'Т-Банк Арина' },
    { id: 'c', name: 'Наличные' },
  ];
  it('однозначное совпадение выбирает счёт, неоднозначное — нет', () => {
    expect(matchAccountInText('такси 800 наличные', accs)).toEqual({ accountId: 'c', description: 'такси 800' });
    expect(matchAccountInText('кофе арина', accs).accountId).toBe('t2');
    expect(matchAccountInText('кофе т-банк', accs).accountId).toBeUndefined();
  });
});
