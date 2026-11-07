import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomInt, randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EntitiesService } from '../entities/entities.service';
import { OllamaService } from '../ai-assistant/ollama.service';
import { FinanceAutomationService } from '../finance/finance-automation.service';
import { FinanceAiService } from '../finance/finance-ai.service';
import { FinancePlanningService } from '../finance/finance-planning.service';
import { FinanceAnalyticsService } from '../finance/finance-analytics.service';
import { PortfolioService } from '../finance/portfolio.service';
import { applyRules } from '../finance/finance-rules';
import { buildCategorizePrompt, parseCategorizeResponse } from '../finance/ai-categorize';
import { HttpTelegramClient, InlineKeyboard, TelegramClient, TgCallbackQuery, TgMessage, TgUpdate } from './telegram-api';
import {
  budgetAlertLevel,
  escapeHtml,
  guessCategoryByKeywords,
  localToday,
  markdownToTelegramHtml,
  parseAllowedChatIds,
  parseEntries,
  ParsedEntry,
  rub,
  truncateForTelegram,
  addDaysIso,
  resolveAccountInText,
  parseEntryLine,
  bankAliases,
} from './telegram-parser';

type Attrs = Record<string, unknown>;

export interface TelegramLink {
  id: string;
  familySpaceId: string;
  telegramUserId: string;
  telegramUsername?: string;
  chatId: string;
  userId: string;
  defaultAccountId?: string;
  defaultScope?: 'PERSONAL' | 'FAMILY';
  notifyBudgets: boolean;
}

interface PendingContext {
  kind: 'saved' | 'needAccount';
  link: TelegramLink;
  chatId: string;
  txIds: string[];
  entries?: ParsedEntry[];
  categoryOptions?: { id: string; name: string }[];
  accountOptions?: { id: string; name: string }[];
  createdAt: number;
}

const COMMANDS = [
  { command: 'help', description: 'Что умеет бот' },
  { command: 'month', description: 'Расходы и доходы за месяц' },
  { command: 'today', description: 'Операции за сегодня' },
  { command: 'budgets', description: 'Бюджеты: сколько осталось' },
  { command: 'plans', description: 'Финансовый план: сколько откладывать' },
  { command: 'goals', description: 'Копилки' },
  { command: 'due', description: 'Обязательные платежи месяца' },
  { command: 'balance', description: 'Счета и чистый капитал' },
  { command: 'report', description: 'ИИ-отчёт за прошлый месяц' },
  { command: 'ask', description: 'Вопрос ИИ про финансы' },
  { command: 'account', description: 'Счёт по умолчанию' },
  { command: 'undo', description: 'Отменить последнюю запись' },
];

const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е');
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const CONTEXT_TTL_MS = 48 * 3600 * 1000;

/**
 * Telegram-бот Family OS (Итерация 4.1).
 *
 * Безопасность:
 *  - токен только в .env (TELEGRAM_BOT_TOKEN), в БД и логах его нет;
 *  - бот отвечает только в чатах из TELEGRAM_ALLOWED_CHAT_IDS;
 *  - каждый человек в чате привязывает СВОЙ Telegram к СВОЕЙ учётке Family OS
 *    одноразовым кодом из веба (/link 123456). Все действия бота идут от
 *    имени этой учётки через обычные сервисы — те же права (FINANCE),
 *    версии записей и журнал аудита, что и в вебе. Без привязки бот ничего
 *    не показывает и не записывает.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TelegramBot');
  private client: TelegramClient | null = null;
  private running = false;
  private offset = 0;
  private botUsername: string | null = null;
  private lastError: string | null = null;
  private lastPollAt: Date | null = null;
  private budgetTimer: ReturnType<typeof setInterval> | null = null;
  private readonly allowedChats = parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
  private readonly linkCodes = new Map<string, { userId: string; familySpaceId: string; expiresAt: number }>();
  private readonly contexts = new Map<string, PendingContext>();
  private readonly lastCreatedByUser = new Map<string, { familySpaceId: string; userId: string; txIds: string[] }>();
  private readonly warnedChats = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entities: EntitiesService,
    private readonly llm: OllamaService,
    private readonly automation: FinanceAutomationService,
    private readonly ai: FinanceAiService,
    private readonly planning: FinancePlanningService,
    private readonly analytics: FinanceAnalyticsService,
    private readonly portfolio: PortfolioService,
  ) {}

  /** Для тестов: подставить фейковый клиент без сети. */
  useClient(client: TelegramClient) {
    this.client = client;
  }

  async onModuleInit() {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) {
      this.logger.log('TELEGRAM_BOT_TOKEN не задан — бот выключен');
      return;
    }
    if (process.env.TELEGRAM_POLLING === 'false') return;
    this.client = new HttpTelegramClient(token, process.env.TELEGRAM_API_URL?.trim() || 'https://api.telegram.org');
    if (this.allowedChats.size === 0) this.logger.warn('TELEGRAM_ALLOWED_CHAT_IDS пуст — бот будет только сообщать ID чата');
    void this.start();
    const minutes = Math.max(5, Number(process.env.TELEGRAM_BUDGET_CHECK_MINUTES || 60));
    this.budgetTimer = setInterval(() => void this.checkAllBudgets().catch((e) => this.logger.warn(`Проверка бюджетов: ${(e as Error).message}`)), minutes * 60000);
  }

  onModuleDestroy() {
    this.running = false;
    if (this.budgetTimer) clearInterval(this.budgetTimer);
  }

  status() {
    return {
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
      running: this.running,
      botUsername: this.botUsername,
      allowedChats: [...this.allowedChats],
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
    };
  }

  private async start() {
    if (!this.client) return;
    try {
      const me = await this.client.getMe();
      this.botUsername = me?.username ?? null;
      await this.client.deleteWebhook();
      await this.client.setMyCommands(COMMANDS);
      this.logger.log(`Бот @${this.botUsername ?? '?'} запущен (long polling)`);
    } catch (e) {
      this.lastError = (e as Error).message;
      this.logger.warn(`Telegram недоступен: ${this.lastError} — повторю попытку`);
    }
    this.running = true;
    let backoff = 5000;
    while (this.running) {
      try {
        const updates = await this.client.getUpdates(this.offset, 25);
        this.lastPollAt = new Date();
        this.lastError = null;
        backoff = 5000;
        for (const u of updates) {
          this.offset = Math.max(this.offset, u.update_id + 1);
          await this.handleUpdate(u).catch((e) => this.logger.error(`update ${u.update_id}: ${(e as Error).message}`));
        }
      } catch (e) {
        this.lastError = (e as Error).message;
        this.logger.warn(`getUpdates: ${this.lastError}`);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60000);
      }
    }
  }

  // ---------- Привязка ----------

  createLinkCode(userId: string, familySpaceId: string): { code: string; expiresAt: string } {
    for (const [c, v] of this.linkCodes) if (v.expiresAt < Date.now() || v.userId === userId) this.linkCodes.delete(c);
    const code = String(randomInt(100000, 999999));
    const expiresAt = Date.now() + LINK_CODE_TTL_MS;
    this.linkCodes.set(code, { userId, familySpaceId, expiresAt });
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  async findLink(telegramUserId: number | string): Promise<TelegramLink | null> {
    const row = await this.prisma.entity.findFirst({
      where: { entityType: 'telegram_link', status: 'ACTIVE', attributes: { path: ['telegramUserId'], equals: String(telegramUserId) } },
      select: { id: true, familySpaceId: true, attributes: true },
    });
    if (!row) return null;
    const a = (row.attributes ?? {}) as Attrs;
    return {
      id: row.id,
      familySpaceId: row.familySpaceId,
      telegramUserId: String(a.telegramUserId),
      telegramUsername: a.telegramUsername as string | undefined,
      chatId: String(a.chatId),
      userId: String(a.userId),
      defaultAccountId: (a.defaultAccountId as string) || undefined,
      defaultScope: a.defaultScope === 'PERSONAL' ? 'PERSONAL' : a.defaultScope === 'FAMILY' ? 'FAMILY' : undefined,
      notifyBudgets: a.notifyBudgets !== false,
    };
  }

  async listLinksForUser(userId: string, familySpaceId: string) {
    const rows = await this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'telegram_link', status: 'ACTIVE' }, select: { id: true, attributes: true, createdAt: true } });
    return (rows as { id: string; attributes: unknown; createdAt: Date }[])
      .map((r) => ({ id: r.id, createdAt: r.createdAt, ...((r.attributes ?? {}) as Attrs) }))
      .filter((r) => (r as Attrs).userId === userId);
  }

  private async linkByCode(msg: TgMessage, code: string) {
    const entry = this.linkCodes.get(code.trim());
    if (!entry || entry.expiresAt < Date.now()) {
      await this.reply(msg, 'Код не найден или истёк. Получите новый в Family OS → Финансы → Telegram.');
      return;
    }
    this.linkCodes.delete(code.trim());
    const from = msg.from!;
    const existing = await this.findLink(from.id);
    if (existing) await this.entities.setStatus(existing.userId, existing.familySpaceId, existing.id, 'ARCHIVED', 'Перепривязка Telegram').catch(() => undefined);
    const accounts = await this.loadAccounts(entry.familySpaceId);
    await this.entities.create(entry.userId, entry.familySpaceId, {
      entityType: 'telegram_link',
      title: `Telegram: ${from.username ? '@' + from.username : from.first_name ?? from.id}`,
      attributes: {
        telegramUserId: String(from.id),
        telegramUsername: from.username ?? from.first_name ?? undefined,
        chatId: String(msg.chat.id),
        userId: entry.userId,
        defaultAccountId: accounts.length === 1 ? accounts[0].id : undefined,
        notifyBudgets: true,
      },
      changeSummary: 'Привязка Telegram по одноразовому коду',
    });
    await this.reply(
      msg,
      `✅ Telegram привязан к Family OS.\n\nПишите траты прямо в чат: <code>350 кофе</code>, <code>такси 800 вчера</code>, <code>+50000 зарплата</code>.\n${accounts.length > 1 ? 'Выберите счёт по умолчанию: /account' : ''}\nВсе команды — /help`,
    );
  }

  // ---------- Обработка входящих ----------

  async handleUpdate(u: TgUpdate) {
    if (u.callback_query) return this.handleCallback(u.callback_query);
    const msg = u.message;
    if (!msg || !msg.from) return;
    if (msg.migrate_to_chat_id) {
      this.logger.warn(`Чат ${msg.chat.id} стал супергруппой ${msg.migrate_to_chat_id} — обновите TELEGRAM_ALLOWED_CHAT_IDS`);
      return;
    }
    const chatId = String(msg.chat.id);
    if (!this.allowedChats.has(chatId)) {
      // Раньше бот после первого предупреждения молчал час — /link и команды
      // уходили «в пустоту». Теперь на команды отвечает всегда (не чаще раза
      // в 30 с), на обычный текст — раз в час.
      const isCommand = (msg.text ?? '').trim().startsWith('/');
      const last = this.warnedChats.get(chatId) ?? 0;
      if (Date.now() - last > (isCommand ? 30000 : 3600000)) {
        this.warnedChats.set(chatId, Date.now());
        this.logger.warn(`Сообщение из неразрешённого чата ${chatId} (${msg.chat.type}) — добавьте его в TELEGRAM_ALLOWED_CHAT_IDS`);
        await this.client?.sendMessage(
          chatId,
          `Этот чат не разрешён для Family OS — команды здесь не выполняются.\nID чата: <code>${escapeHtml(chatId)}</code>\nДобавьте его в TELEGRAM_ALLOWED_CHAT_IDS на сервере (через запятую) и перезапустите api.`,
        );
      }
      return;
    }
    const text = (msg.text ?? '').trim();
    if (!text) return;

    const cmdMatch = text.match(/^\/([a-z_]+)(?:@[\w_]+)?(?:\s+([\s\S]*))?$/i);
    const command = cmdMatch?.[1]?.toLowerCase();
    const args = (cmdMatch?.[2] ?? '').trim();

    if (command === 'start' || command === 'help') return this.reply(msg, this.helpText(chatId));
    if (command === 'link') return args ? this.linkByCode(msg, args) : this.reply(msg, 'Отправьте <code>/link КОД</code> — код в Family OS → Финансы → Telegram.');

    const link = await this.findLink(msg.from.id);
    if (!link) {
      if (command || parseEntries(text, localToday())) {
        await this.reply(msg, 'Сначала привяжите свой Telegram: в Family OS откройте Финансы → Telegram, получите код и отправьте <code>/link КОД</code>.');
      }
      return;
    }

    try {
      switch (command) {
        case 'month':
          return await this.cmdMonth(msg, link, args);
        case 'today':
          return await this.cmdToday(msg, link);
        case 'budgets':
          return await this.cmdBudgets(msg, link);
        case 'plans':
          return await this.cmdPlans(msg, link);
        case 'goals':
          return await this.cmdGoals(msg, link);
        case 'due':
          return await this.cmdDue(msg, link);
        case 'balance':
          return await this.cmdBalance(msg, link);
        case 'report':
          return await this.cmdReport(msg, link);
        case 'ask':
          return await this.cmdAsk(msg, link, args);
        case 'account':
          return await this.cmdAccount(msg, link);
        case 'undo':
          return await this.cmdUndo(msg, link);
        case 'unlink':
          await this.entities.setStatus(link.userId, link.familySpaceId, link.id, 'ARCHIVED', 'Отвязка Telegram из бота');
          return await this.reply(msg, 'Telegram отвязан. Записи, сделанные через бота, остаются в Family OS.');
        case 'add':
        case 'r':
          return await this.recordEntries(msg, link, args);
        case undefined:
          return await this.recordEntries(msg, link, text, true);
        default:
          return await this.reply(msg, 'Не знаю такой команды. /help');
      }
    } catch (e) {
      this.logger.warn(`Команда ${command ?? 'запись'}: ${(e as Error).message}`);
      await this.reply(msg, `⚠️ ${escapeHtml((e as Error).message || 'Ошибка')}`);
    }
  }

  private helpText(chatId: string) {
    return [
      '<b>Family OS — финансы в Telegram</b>',
      '',
      '<b>Записать трату</b> — просто напишите:',
      '<code>350 кофе</code> · <code>такси 800 вчера</code> · <code>05.11 аптека 1200</code>',
      '<code>+50000 зарплата</code> — доход · <code>кино 900 личное</code> — личный расход',
      'Можно несколько строк — несколько операций. Категорию определят правила, словарь или ИИ; поправить — кнопкой.',
      '',
      '/month — месяц (/month prev — прошлый) · /today — сегодня',
      '/budgets — бюджеты · /due — обязательные платежи',
      '/plans — план накоплений · /goals — копилки',
      '/balance — счета и капитал · /report — ИИ-отчёт',
      '/ask вопрос — спросить ИИ · /account — счёт по умолчанию · /undo — отменить последнюю запись',
      '',
      `Привязка: <code>/link КОД</code> (код — в Family OS → Финансы → Telegram). ID этого чата: <code>${escapeHtml(chatId)}</code>`,
      'В группе бот видит обычные сообщения, только если в @BotFather отключён privacy mode; иначе пишите <code>/r 350 кофе</code>.',
    ].join('\n');
  }

  private async reply(msg: TgMessage, text: string, keyboard?: InlineKeyboard) {
    return this.client?.sendMessage(msg.chat.id, truncateForTelegram(text), keyboard) ?? null;
  }

  // ---------- Быстрая запись ----------

  private async loadAccounts(familySpaceId: string) {
    const [rows, banks, people] = await Promise.all([
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'bank_account', status: 'ACTIVE' }, select: { id: true, title: true, ownerPersonId: true, attributes: true } }),
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'bank' }, select: { id: true, title: true, attributes: true } }),
      this.prisma.person.findMany({ where: { familySpaceId }, select: { id: true, fullName: true } }),
    ]);
    const bankName = new Map((banks as { id: string; title: string; attributes: unknown }[]).map((b) => [b.id, String(((b.attributes ?? {}) as Attrs).name ?? b.title)]));
    const personName = new Map((people as { id: string; fullName: string }[]).map((p) => [p.id, p.fullName]));
    return (rows as { id: string; title: string; ownerPersonId?: string | null; attributes: unknown }[]).map((r) => {
      const a = (r.attributes ?? {}) as Attrs;
      const bank: string | undefined = (a.bankId ? bankName.get(String(a.bankId)) : undefined) || (typeof a.bankName === 'string' ? a.bankName : undefined);
      const name = String(a.accountName || r.title);
      return {
        id: r.id,
        name,
        bankName: bank || undefined,
        ownerPersonId: r.ownerPersonId ?? null,
        ownerName: r.ownerPersonId ? personName.get(r.ownerPersonId) : undefined,
        isShared: a.isShared === true || !r.ownerPersonId,
        // Подпись для кнопок/сообщений: два «Семейных счёта» различаются банком.
        label: bank && !bankAliases(bank).some((al) => norm(name).includes(al)) ? `${name} · ${bank}` : name,
        currency: String(a.currency ?? 'RUB'),
      };
    });
  }

  private async senderPersonId(link: TelegramLink): Promise<string | null> {
    const m = await this.prisma.membership.findUnique({ where: { familySpaceId_userId: { familySpaceId: link.familySpaceId, userId: link.userId } }, select: { personId: true } }).catch(() => null);
    return m?.personId ?? null;
  }

  private async loadCategories(familySpaceId: string, preferType: 'EXPENSE' | 'INCOME') {
    const [rows, txs] = await Promise.all([
      this.prisma.entity.findMany({ where: { familySpaceId, entityType: 'financial_category', status: 'ACTIVE' }, select: { id: true, title: true, attributes: true } }),
      this.automation.loadActiveTransactions(familySpaceId),
    ]);
    const usage = new Map<string, number>();
    for (const t of txs) if (t.attributes.categoryId) usage.set(String(t.attributes.categoryId), (usage.get(String(t.attributes.categoryId)) ?? 0) + 1);
    return (rows as { id: string; title: string; attributes: unknown }[])
      .map((r) => {
        const a = (r.attributes ?? {}) as Attrs;
        return { id: r.id, name: String(a.name ?? r.title), type: String(a.categoryType ?? 'EXPENSE') };
      })
      .filter((c) => c.type === preferType || c.type === 'TRANSFER' ? c.type === preferType : true)
      .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  }

  private token(): string {
    for (const [k, v] of this.contexts) if (Date.now() - v.createdAt > CONTEXT_TTL_MS) this.contexts.delete(k);
    return randomBytes(5).toString('hex');
  }

  async recordEntries(msg: TgMessage, link: TelegramLink, text: string, silentIfNotParsed = false) {
    const today = localToday();
    if (!parseEntries(text, today)) {
      if (!silentIfNotParsed) await this.reply(msg, 'Не нашёл сумму. Пример: <code>350 кофе</code>');
      else if (msg.chat.type === 'private') await this.reply(msg, 'Не понял. Для траты напишите сумму и описание, например <code>350 кофе</code>. Команды — /help');
      return;
    }
    const accounts = await this.loadAccounts(link.familySpaceId);
    if (accounts.length === 0) return this.reply(msg, 'В Family OS нет ни одного счёта — заведите счёт в разделе «Финансы».');
    const sender = accounts.length > 1 ? await this.senderPersonId(link) : null;
    const fallback = link.defaultAccountId && accounts.some((a) => a.id === link.defaultAccountId) ? link.defaultAccountId : accounts.length === 1 ? accounts[0].id : undefined;

    // Счёт определяется по строке ДО разбора: «семейный счёт альфа» — это счёт, а не тип расхода.
    const groups = new Map<string, ParsedEntry[]>();
    const ambiguousIds = new Set<string>();
    const unresolved: ParsedEntry[] = [];
    for (const line of text.split(/\r?\n/).slice(0, 20)) {
      if (!line.trim()) continue;
      const r = accounts.length > 1 ? resolveAccountInText(line, accounts, sender) : { text: line } as { text: string; accountId?: string; ambiguous?: string[] };
      const entry = parseEntryLine(r.text, today);
      if (!entry) continue;
      if (r.ambiguous) {
        r.ambiguous.forEach((id) => ambiguousIds.add(id));
        unresolved.push(entry);
        continue;
      }
      const accountId = r.accountId ?? fallback;
      if (!accountId) {
        unresolved.push(entry);
        continue;
      }
      if (!groups.has(accountId)) groups.set(accountId, []);
      groups.get(accountId)!.push(entry);
    }

    let offset = 0;
    for (const [accountId, entries] of groups) {
      await this.saveEntries(msg.chat.id, msg.message_id, link, entries, accountId, undefined, offset);
      offset += entries.length;
    }
    if (unresolved.length) {
      const options = (ambiguousIds.size ? accounts.filter((a) => ambiguousIds.has(a.id)) : accounts).slice(0, 10);
      const token = this.token();
      this.contexts.set(token, { kind: 'needAccount', link, chatId: String(msg.chat.id), txIds: [], entries: unresolved, accountOptions: options.map((o) => ({ id: o.id, name: o.label })), createdAt: Date.now() });
      const question = ambiguousIds.size
        ? `На какой счёт записать «${escapeHtml(unresolved[0].description)}»? Подходят несколько:`
        : 'На какой счёт записать? (запомню как счёт по умолчанию)';
      await this.reply(msg, question, options.map((a, i) => [{ text: a.label, callback_data: `${ambiguousIds.size ? 'o' : 'a'}:${token}:${i}` }]));
    }
  }

  private async saveEntries(chatId: number | string, messageId: number, link: TelegramLink, entries: ParsedEntry[], accountId: string, editMessageId?: number, indexOffset = 0) {
    const [accounts, rules, catsExpense, catsIncome] = await Promise.all([
      this.loadAccounts(link.familySpaceId),
      this.automation.loadRules(link.familySpaceId),
      this.loadCategories(link.familySpaceId, 'EXPENSE'),
      this.loadCategories(link.familySpaceId, 'INCOME'),
    ]);
    const account = accounts.find((a) => a.id === accountId)!;
    const created: { id: string; entry: ParsedEntry; categoryId?: string; categorySource?: string; scope?: string }[] = [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const externalId = `tg:${chatId}:${messageId}:${i + indexOffset}`;
      // Telegram может повторно доставить сообщение после перезапуска — ключ дедупликации не даст задвоить.
      const dup = await this.prisma.financialTransactionExternalId.findUnique({ where: { accountEntityId_externalId: { accountEntityId: accountId, externalId } } });
      if (dup) continue;

      const cats = e.amount < 0 ? catsExpense : catsIncome;
      const ruled = applyRules({ description: e.description, amount: e.amount, accountId, transactionType: e.amount < 0 ? 'EXPENSE' : 'INCOME' }, rules, { onlyEmpty: true });
      let categoryId = ruled.changes.categoryId;
      let categorySource = categoryId ? `правило «${ruled.matchedRuleNames[0]}»` : undefined;
      if (!categoryId) {
        categoryId = guessCategoryByKeywords(e.description, cats);
        if (categoryId) categorySource = 'по словам';
      }
      const scope = e.scope ?? ruled.changes.scope ?? link.defaultScope ?? 'FAMILY';
      const tx = await this.entities.create(link.userId, link.familySpaceId, {
        entityType: 'financial_transaction',
        title: `${e.date}: ${e.description}`,
        attributes: {
          date: e.date,
          amount: e.amount,
          currency: account.currency,
          accountId,
          description: e.description,
          categoryId: categoryId || undefined,
          scope,
          counterparty: ruled.changes.counterparty,
          transactionType: ruled.changes.transactionType ?? (e.amount < 0 ? 'EXPENSE' : 'INCOME'),
          source: 'MANUAL',
          externalId,
          notes: 'Записано через Telegram',
        },
        changeSummary: 'Запись из Telegram',
      });
      await this.prisma.financialTransactionExternalId.create({ data: { familySpaceId: link.familySpaceId, accountEntityId: accountId, externalId, transactionEntityId: tx.id } });
      created.push({ id: tx.id, entry: e, categoryId, categorySource, scope });
    }
    if (created.length === 0) return;

    this.lastCreatedByUser.set(link.telegramUserId, { familySpaceId: link.familySpaceId, userId: link.userId, txIds: created.map((c) => c.id) });
    const catName = new Map([...catsExpense, ...catsIncome].map((c) => [c.id, c.name]));
    const token = this.token();
    const expenseCats = catsExpense.slice(0, 12);
    this.contexts.set(token, { kind: 'saved', link, chatId: String(chatId), txIds: created.map((c) => c.id), categoryOptions: expenseCats, createdAt: Date.now() });

    const render = (rows: typeof created) =>
      [
        `✅ Записал${rows.length > 1 ? ` ${rows.length} операции` : ''} · <b>${escapeHtml(account.label)}</b>`,
        ...rows.map(
          (c) =>
            `${c.entry.amount < 0 ? '−' : '+'}${rub(Math.abs(c.entry.amount), account.currency)} · ${escapeHtml(c.entry.description)}${c.entry.date !== localToday() ? ` · ${c.entry.date.slice(8, 10)}.${c.entry.date.slice(5, 7)}` : ''}\n   ${c.categoryId ? `📂 ${escapeHtml(catName.get(c.categoryId) ?? '')} <i>(${c.categorySource})</i>` : '📂 без категории'} · ${c.scope === 'PERSONAL' ? '👤 личный' : '👪 семейный'}`,
        ),
      ].join('\n');
    const keyboard: InlineKeyboard = [
      [
        ...(created.length === 1 ? [{ text: '📂 Категория', callback_data: `k:${token}` }] : []),
        { text: created.every((c) => c.scope === 'PERSONAL') ? '👪 Сделать семейным' : '👤 Сделать личным', callback_data: `s:${token}` },
        { text: '↩️ Отменить', callback_data: `u:${token}` },
      ],
    ];
    const sent = editMessageId
      ? (await this.client?.editMessage(chatId, editMessageId, render(created), keyboard), { message_id: editMessageId })
      : await this.client?.sendMessage(chatId, render(created), keyboard);

    await this.audit.log({ familySpaceId: link.familySpaceId, actorUserId: link.userId, action: 'telegram.transactions_created', resourceType: 'financial_transaction', metadata: { count: created.length, chatId: String(chatId) } });

    // ИИ — для того, что не определили правила и словарь. В фоне: ответ модели на CPU — десятки секунд.
    const uncategorized = created.filter((c) => !c.categoryId);
    if (uncategorized.length && this.llm.isConfigured() && sent?.message_id) {
      void this.aiCategorize(link, uncategorized, [...catsExpense, ...catsIncome]).then(async (applied) => {
        if (!applied.size) return;
        for (const c of created) {
          const cid = applied.get(c.id);
          if (cid) {
            c.categoryId = cid;
            c.categorySource = 'ИИ';
          }
        }
        await this.client?.editMessage(chatId, sent.message_id, render(created), keyboard);
      });
    }

    void this.checkBudgets(link).catch((e) => this.logger.warn(`Бюджеты: ${(e as Error).message}`));
  }

  private async aiCategorize(link: TelegramLink, items: { id: string; entry: ParsedEntry }[], cats: { id: string; name: string }[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    try {
      const txs = items.map((i) => ({ id: i.id, description: i.entry.description, amount: i.entry.amount }));
      const res = await this.llm.complete(buildCategorizePrompt(txs, cats.map((c) => c.name)), { json: true, timeoutMs: 180000 });
      if (!res) return result;
      for (const s of parseCategorizeResponse(res.text, txs, cats)) {
        await this.entities.update(link.userId, link.familySpaceId, s.transactionId, { attributes: { categoryId: s.categoryId }, changeSummary: `Категория определена ИИ (${res.endpoint.model}) — можно поправить` });
        result.set(s.transactionId, s.categoryId);
      }
    } catch (e) {
      this.logger.warn(`ИИ-категория: ${(e as Error).message}`);
    }
    return result;
  }

  // ---------- Кнопки ----------

  async handleCallback(q: TgCallbackQuery) {
    const [kind, token, arg] = (q.data ?? '').split(':');
    const ctx = this.contexts.get(token);
    if (!ctx || !q.message) {
      await this.client?.answerCallback(q.id, 'Кнопка устарела');
      return;
    }
    // Кнопками может пользоваться только тот, кто сделал запись (или тот, чья она).
    if (String(q.from.id) !== ctx.link.telegramUserId) {
      await this.client?.answerCallback(q.id, 'Это запись другого участника');
      return;
    }
    const link = (await this.findLink(q.from.id)) ?? ctx.link;
    const chatId = q.message.chat.id;
    const messageId = q.message.message_id;

    if (kind === 'o' && ctx.kind === 'needAccount') {
      const account = ctx.accountOptions?.[Number(arg)];
      if (!account || !ctx.entries) return void (await this.client?.answerCallback(q.id, 'Счёт не найден'));
      this.contexts.delete(token);
      await this.client?.answerCallback(q.id, account.name);
      await this.saveEntries(chatId, messageId, link, ctx.entries, account.id, messageId, 50);
      return;
    }
    if (kind === 'a' && ctx.kind === 'needAccount') {
      const account = ctx.accountOptions?.[Number(arg)];
      if (!account || !ctx.entries) return void (await this.client?.answerCallback(q.id, 'Счёт не найден'));
      await this.entities.update(link.userId, link.familySpaceId, link.id, { attributes: { defaultAccountId: account.id }, changeSummary: 'Счёт по умолчанию для Telegram' });
      this.contexts.delete(token);
      await this.client?.answerCallback(q.id, `Счёт: ${account.name}`);
      await this.saveEntries(chatId, messageId, { ...link, defaultAccountId: account.id }, ctx.entries, account.id, messageId, 50);
      return;
    }
    if (kind === 'd') {
      // Выбор счёта по умолчанию из /account
      const account = ctx.accountOptions?.[Number(arg)];
      if (!account) return void (await this.client?.answerCallback(q.id));
      await this.entities.update(link.userId, link.familySpaceId, link.id, { attributes: { defaultAccountId: account.id }, changeSummary: 'Счёт по умолчанию для Telegram' });
      await this.client?.answerCallback(q.id, 'Сохранено');
      await this.client?.editMessage(chatId, messageId, `💳 Счёт по умолчанию: <b>${escapeHtml(account.name)}</b>`);
      return;
    }
    if (kind === 'u') {
      for (const id of ctx.txIds) await this.entities.setStatus(link.userId, link.familySpaceId, id, 'ARCHIVED', 'Отменено в Telegram').catch(() => undefined);
      this.contexts.delete(token);
      await this.client?.answerCallback(q.id, 'Отменено');
      await this.client?.editMessage(chatId, messageId, `↩️ Отменено (${ctx.txIds.length} шт.) — запись перенесена в архив.`);
      return;
    }
    if (kind === 's') {
      const rows = await this.prisma.entity.findMany({ where: { id: { in: ctx.txIds } }, select: { id: true, attributes: true } });
      const allPersonal = (rows as { attributes: unknown }[]).every((r) => ((r.attributes ?? {}) as Attrs).scope === 'PERSONAL');
      const next = allPersonal ? 'FAMILY' : 'PERSONAL';
      for (const id of ctx.txIds) await this.entities.update(link.userId, link.familySpaceId, id, { attributes: { scope: next }, changeSummary: 'Тип расхода изменён в Telegram' });
      await this.client?.answerCallback(q.id, next === 'PERSONAL' ? 'Теперь личный' : 'Теперь семейный');
      const text = (q.message.text ?? '').replace(/👤 личный|👪 семейный/g, next === 'PERSONAL' ? '👤 личный' : '👪 семейный');
      await this.client?.editMessage(chatId, messageId, escapeHtml(text), [
        [
          ...(ctx.txIds.length === 1 ? [{ text: '📂 Категория', callback_data: `k:${token}` }] : []),
          { text: next === 'PERSONAL' ? '👪 Сделать семейным' : '👤 Сделать личным', callback_data: `s:${token}` },
          { text: '↩️ Отменить', callback_data: `u:${token}` },
        ],
      ]);
      return;
    }
    if (kind === 'k') {
      const opts = ctx.categoryOptions ?? [];
      const keyboard: InlineKeyboard = [];
      for (let i = 0; i < opts.length; i += 2) keyboard.push(opts.slice(i, i + 2).map((c, j) => ({ text: c.name.slice(0, 30), callback_data: `c:${token}:${i + j}` })));
      keyboard.push([{ text: '↩️ Отменить запись', callback_data: `u:${token}` }]);
      await this.client?.answerCallback(q.id);
      await this.client?.editMessage(chatId, messageId, `${escapeHtml(q.message.text ?? '')}\n\nВыберите категорию:`, keyboard);
      return;
    }
    if (kind === 'c') {
      const cat = ctx.categoryOptions?.[Number(arg)];
      if (!cat) return void (await this.client?.answerCallback(q.id));
      for (const id of ctx.txIds) await this.entities.update(link.userId, link.familySpaceId, id, { attributes: { categoryId: cat.id }, changeSummary: 'Категория выбрана в Telegram' });
      await this.client?.answerCallback(q.id, cat.name);
      const base = (q.message.text ?? '').split('\n\nВыберите категорию:')[0].replace(/📂 [^·\n]+/, `📂 ${cat.name} `);
      await this.client?.editMessage(chatId, messageId, escapeHtml(base), [
        [
          { text: '📂 Категория', callback_data: `k:${token}` },
          { text: '↩️ Отменить', callback_data: `u:${token}` },
        ],
      ]);
      void this.checkBudgets(link).catch(() => undefined);
      return;
    }
    await this.client?.answerCallback(q.id);
  }

  // ---------- Команды-отчёты ----------

  private monthRange(prev: boolean) {
    const today = localToday();
    const [y, m] = today.split('-').map(Number);
    const s = new Date(Date.UTC(y, m - 1 - (prev ? 1 : 0), 1));
    const e = new Date(Date.UTC(y, m - (prev ? 1 : 0), 0));
    return { start: s.toISOString().slice(0, 10), end: prev ? e.toISOString().slice(0, 10) : today };
  }

  private async cmdMonth(msg: TgMessage, link: TelegramLink, args: string) {
    const prev = /prev|прош/i.test(args);
    const { start, end } = this.monthRange(prev);
    const { facts } = await this.ai.buildFacts(link.userId, link.familySpaceId, start, end);
    const lines = [
      `<b>${prev ? 'Прошлый месяц' : 'Этот месяц'}</b> (${start.slice(8, 10)}.${start.slice(5, 7)}–${end.slice(8, 10)}.${end.slice(5, 7)})`,
      `Доходы: <b>${rub(facts.income)}</b>`,
      `Расходы: <b>${rub(facts.expense)}</b>${facts.expenseChangePercent !== null ? ` (${facts.expenseChangePercent > 0 ? '+' : ''}${facts.expenseChangePercent}% к прошлому)` : ''}`,
      `Итог: <b>${rub(facts.net)}</b>${facts.savingsRatePercent !== null ? ` · сбережения ${facts.savingsRatePercent}%` : ''}`,
      `Семейные ${rub(facts.familyExpense)} · личные ${rub(facts.personalExpense)}`,
      '',
      ...facts.categories.slice(0, 8).map((c) => `• ${escapeHtml(c.category)}: ${rub(c.expense)} (${c.share}%)`),
    ];
    if (facts.anomalies.length) lines.push('', '⚠️ Выше обычного: ' + facts.anomalies.map((a) => `${escapeHtml(a.category)} +${a.overPercent}%`).join(', '));
    if (facts.uncategorizedCount) lines.push(`Без категории: ${facts.uncategorizedCount} на ${rub(facts.uncategorizedExpense)}`);
    await this.reply(msg, lines.join('\n'));
  }

  private async cmdToday(msg: TgMessage, link: TelegramLink) {
    const today = localToday();
    const txs = (await this.automation.loadActiveTransactions(link.familySpaceId)).filter((t) => t.attributes.date === today && t.attributes.transactionType !== 'TRANSFER');
    if (!txs.length) return this.reply(msg, 'Сегодня операций нет.');
    const total = txs.reduce((s, t) => s + Math.min(0, Number(t.attributes.amount) || 0), 0);
    await this.reply(msg, [`<b>Сегодня</b> — расходы ${rub(-total)}`, ...txs.slice(0, 30).map((t) => `${Number(t.attributes.amount) < 0 ? '−' : '+'}${rub(Math.abs(Number(t.attributes.amount)))} · ${escapeHtml(String(t.attributes.description ?? ''))}`)].join('\n'));
  }

  private async cmdBudgets(msg: TgMessage, link: TelegramLink) {
    const budgets = await this.prisma.entity.findMany({ where: { familySpaceId: link.familySpaceId, entityType: 'budget', status: 'ACTIVE' }, select: { id: true, title: true } });
    if (!budgets.length) return this.reply(msg, 'Бюджетов нет.');
    const lines = ['<b>Бюджеты</b>'];
    for (const b of budgets as { id: string; title: string }[]) {
      const s = await this.analytics.getBudgetStatus(link.userId, link.familySpaceId, b.id);
      if (!s) continue;
      const p = s.percentUsed ?? 0;
      const icon = p >= 100 ? '🔴' : p >= 80 ? '🟡' : '🟢';
      lines.push(`${icon} ${escapeHtml(b.title)}: ${rub(s.spent)} из ${rub(s.plannedExpense)} (${s.percentUsed ?? '—'}%) · осталось ${rub(s.remaining)}`);
    }
    await this.reply(msg, lines.join('\n'));
  }

  private async cmdPlans(msg: TgMessage, link: TelegramLink) {
    const p = await this.planning.getPlan(link.userId, link.familySpaceId);
    const lines = [
      '<b>Финансовый план</b>',
      `Свободно в месяц: <b>${rub(p.monthlyCapacity)}</b> (медиана за ${p.historyMonths} мес.)`,
      `Нужно на планы: <b>${rub(p.totalRequired)}</b> · остаётся ${rub(p.freeAfterPlans)}`,
      '',
      ...p.plans.map((x) => `${x.fits ? '✅' : '⏳'} ${escapeHtml(x.name)}${x.scope === 'PERSONAL' ? ` (${escapeHtml(x.ownerName ?? 'личный')})` : ''}: ${rub(x.allocatedMonthly)}/мес из ${rub(x.requiredMonthly)}${x.dueDate ? ` · к ${x.dueDate.slice(8, 10)}.${x.dueDate.slice(5, 7)}.${x.dueDate.slice(0, 4)}` : ''}${!x.fits && x.projectedDate ? ` → успеем к ${x.projectedDate.slice(8, 10)}.${x.projectedDate.slice(5, 7)}.${x.projectedDate.slice(0, 4)}` : ''}`),
    ];
    if (p.suggestions.length) lines.push('', ...p.suggestions.slice(0, 5).map((s) => `💡 ${escapeHtml(s.text)}`));
    if (!p.plans.length) lines.push('Планов пока нет — добавьте в Family OS → Финансы → План.');
    await this.reply(msg, lines.join('\n'));
  }

  private async cmdGoals(msg: TgMessage, link: TelegramLink) {
    const goals = (await this.automation.getGoalsSummary(link.userId, link.familySpaceId)).filter((g) => g.entityStatus === 'ACTIVE');
    if (!goals.length) return this.reply(msg, 'Копилок нет.');
    await this.reply(
      msg,
      ['<b>Копилки</b>', ...goals.map((g) => `${g.icon ?? '🐷'} ${escapeHtml(g.name)}: ${rub(g.savedAmount)} из ${rub(g.targetAmount)} (${g.percent}%)${g.estimatedDate && !g.isCompleted ? ` · ≈ к ${g.estimatedDate.slice(8, 10)}.${g.estimatedDate.slice(5, 7)}.${g.estimatedDate.slice(0, 4)}` : ''}`)].join('\n'),
    );
  }

  private async cmdDue(msg: TgMessage, link: TelegramLink) {
    const s = await this.automation.getNeedsStatus(link.userId, link.familySpaceId, localToday().slice(0, 7));
    if (!s.items.length) return this.reply(msg, 'Обязательных платежей нет.');
    const icon = { PAID: '✅', DUE: '🕒', OVERDUE: '❗' } as const;
    await this.reply(msg, [`<b>Обязательные платежи</b> — оплачено ${rub(s.paid)} из ${rub(s.planned)}`, ...s.items.map((n) => `${icon[n.status]} ${escapeHtml(n.name)}: ${rub(n.status === 'PAID' ? n.paidAmount : n.plannedAmount)}${n.dueDate && n.status !== 'PAID' ? ` до ${n.dueDate.slice(8, 10)}.${n.dueDate.slice(5, 7)}` : ''}`)].join('\n'));
  }

  private async cmdBalance(msg: TgMessage, link: TelegramLink) {
    const rows = await this.prisma.entity.findMany({ where: { familySpaceId: link.familySpaceId, entityType: 'bank_account', status: 'ACTIVE' }, select: { title: true, attributes: true } });
    const nw = await this.portfolio.getNetWorth(link.userId, link.familySpaceId);
    await this.reply(
      msg,
      [
        '<b>Счета</b>',
        ...(rows as { title: string; attributes: unknown }[]).map((r) => {
          const a = (r.attributes ?? {}) as Attrs;
          return `• ${escapeHtml(String(a.accountName || r.title))}: ${a.currentBalance !== undefined ? rub(Number(a.currentBalance), String(a.currency ?? 'RUB')) : '—'}`;
        }),
        '',
        `Чистый капитал: <b>${rub(nw.netWorth)}</b> (кредиты ${rub(nw.loansBalance)}, вклады ${rub(nw.investmentsValue)})`,
      ].join('\n'),
    );
  }

  private async cmdReport(msg: TgMessage, link: TelegramLink) {
    const { start, end } = this.monthRange(true);
    const report = await this.ai.createReport(link.userId, link.familySpaceId, { periodStart: start, periodEnd: end });
    await this.reply(msg, `📊 Считаю отчёт за ${start.slice(5, 7)}.${start.slice(0, 4)}. ИИ пишет выводы — пришлю, когда будет готово (на ноутбуке до нескольких минут).`);
    const deadline = Date.now() + 8 * 60000;
    const poll = async () => {
      const r = await this.prisma.entity.findUnique({ where: { id: report.id }, select: { attributes: true } });
      const a = ((r?.attributes ?? {}) as Attrs) || {};
      if (a.reportStatus === 'READY' || Date.now() > deadline) {
        const text = a.narrative ? markdownToTelegramHtml(String(a.narrative)) : 'Отчёт не успел сформироваться — посмотрите в Family OS → ИИ-отчёты.';
        const warn = Array.isArray(a.warnings) && a.warnings.length ? `\n\n⚠️ ${escapeHtml((a.warnings as string[]).join(' '))}` : '';
        await this.client?.sendMessage(msg.chat.id, truncateForTelegram(`<b>Отчёт за ${start.slice(5, 7)}.${start.slice(0, 4)}</b>${a.modelUsed ? ` · <i>${escapeHtml(String(a.modelUsed))}</i>` : ''}\n\n${text}${warn}`));
        return;
      }
      setTimeout(() => void poll().catch(() => undefined), 10000);
    };
    setTimeout(() => void poll().catch(() => undefined), 5000);
  }

  private async cmdAsk(msg: TgMessage, link: TelegramLink, question: string) {
    if (!question) return this.reply(msg, 'Напишите вопрос: <code>/ask на что ушло больше всего в этом месяце?</code>');
    // Баланс счёта — точный факт из базы, ИИ тут не нужен (и может перепутать копейки).
    if (/баланс|остат|сколько\s+(денег\s+)?(на|в)\s/i.test(question)) {
      const accounts = await this.loadAccounts(link.familySpaceId);
      const r = resolveAccountInText(question, accounts, await this.senderPersonId(link));
      const picked = r.accountId ? accounts.filter((a) => a.id === r.accountId) : r.ambiguous ? accounts.filter((a) => r.ambiguous!.includes(a.id)) : [];
      if (picked.length) return this.replyBalances(msg, link, picked.map((a) => a.id));
      if (/(все|всех|счета|счетам|итого|всего)/i.test(question)) return this.cmdBalance(msg, link);
    }
    await this.reply(msg, '🤔 Думаю…');
    const { start, end } = this.monthRange(false);
    const res = await this.ai.ask(link.userId, link.familySpaceId, { question, periodStart: start, periodEnd: end });
    if (res.unavailable || !res.answer) return this.reply(msg, 'ИИ сейчас недоступен. Цифры — /month.');
    const warn = res.unverifiedNumbers?.length ? `\n\n⚠️ Числа не из расчётов: ${escapeHtml(res.unverifiedNumbers.join(', '))}` : '';
    await this.reply(msg, `${markdownToTelegramHtml(res.answer)}${warn}`);
  }

  private async replyBalances(msg: TgMessage, link: TelegramLink, ids: string[]) {
    const rows = await this.prisma.entity.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, attributes: true } });
    const labels = new Map((await this.loadAccounts(link.familySpaceId)).map((a) => [a.id, a.label]));
    const lines = (rows as { id: string; title: string; attributes: unknown }[]).map((r) => {
      const a = (r.attributes ?? {}) as Attrs;
      const bal = typeof a.currentBalance === 'number' ? rub(a.currentBalance, String(a.currency ?? 'RUB')) : 'баланс не указан';
      return `💳 <b>${escapeHtml(labels.get(r.id) ?? String(a.accountName || r.title))}</b>: ${bal}`;
    });
    await this.reply(msg, `${lines.join('\n')}\n<i>Баланс — из карточки счёта в Family OS.</i>`);
  }

  private async cmdAccount(msg: TgMessage, link: TelegramLink) {
    const accounts = await this.loadAccounts(link.familySpaceId);
    if (!accounts.length) return this.reply(msg, 'Счетов нет.');
    const token = this.token();
    this.contexts.set(token, { kind: 'saved', link, chatId: String(msg.chat.id), txIds: [], accountOptions: accounts.slice(0, 10).map((a) => ({ id: a.id, name: a.label })), createdAt: Date.now() });
    const current = accounts.find((a) => a.id === link.defaultAccountId);
    await this.reply(msg, `Счёт по умолчанию: <b>${escapeHtml(current?.label ?? 'не выбран')}</b>. Выберите:`, accounts.slice(0, 10).map((a, i) => [{ text: a.label, callback_data: `d:${token}:${i}` }]));
  }

  private async cmdUndo(msg: TgMessage, link: TelegramLink) {
    const last = this.lastCreatedByUser.get(link.telegramUserId);
    if (!last) return this.reply(msg, 'Нечего отменять (после перезапуска сервера история кнопок сбрасывается — архивируйте запись в Family OS).');
    for (const id of last.txIds) await this.entities.setStatus(last.userId, last.familySpaceId, id, 'ARCHIVED', 'Отменено в Telegram (/undo)').catch(() => undefined);
    this.lastCreatedByUser.delete(link.telegramUserId);
    await this.reply(msg, `↩️ Отменено: ${last.txIds.length} шт.`);
  }

  // ---------- Уведомления о бюджетах ----------

  async checkAllBudgets() {
    if (!this.client) return;
    const links = await this.prisma.entity.findMany({ where: { entityType: 'telegram_link', status: 'ACTIVE' }, select: { id: true } });
    const seenSpaces = new Set<string>();
    for (const l of links as { id: string }[]) {
      const row = await this.prisma.entity.findUnique({ where: { id: l.id }, select: { familySpaceId: true, attributes: true } });
      if (!row || seenSpaces.has(row.familySpaceId)) continue;
      const link = await this.findLink(String(((row.attributes ?? {}) as Attrs).telegramUserId));
      if (!link) continue;
      seenSpaces.add(link.familySpaceId);
      await this.checkBudgets(link);
    }
  }

  /**
   * Проверяет бюджеты пространства и шлёт в чаты привязок уведомление при
   * достижении порога (alertThresholdPercent, по умолчанию 80%) и при
   * превышении 100%. Повтор не шлётся: факт отправки — запись аудита
   * telegram.budget_alert с ключом бюджет+период+уровень.
   */
  async checkBudgets(link: TelegramLink) {
    if (!this.client) return;
    const [budgets, linkRows] = await Promise.all([
      this.prisma.entity.findMany({ where: { familySpaceId: link.familySpaceId, entityType: 'budget', status: 'ACTIVE' }, select: { id: true, title: true, attributes: true } }),
      this.prisma.entity.findMany({ where: { familySpaceId: link.familySpaceId, entityType: 'telegram_link', status: 'ACTIVE' }, select: { attributes: true } }),
    ]);
    const chatIds = [...new Set((linkRows as { attributes: unknown }[]).map((r) => (r.attributes ?? {}) as Attrs).filter((a) => a.notifyBudgets !== false && this.allowedChats.has(String(a.chatId))).map((a) => String(a.chatId)))];
    if (!chatIds.length) return;
    const today = localToday();

    for (const b of budgets as { id: string; title: string; attributes: unknown }[]) {
      const a = (b.attributes ?? {}) as Attrs;
      if (a.notificationEnabled === false) continue;
      const start = String(a.startDate ?? '');
      const end = a.endDate ? String(a.endDate) : '9999-12-31';
      if (start > today || end < today) continue; // бюджет не действует сейчас
      const status = await this.analytics.getBudgetStatus(link.userId, link.familySpaceId, b.id);
      if (!status || !status.plannedExpense) continue;
      const level = budgetAlertLevel(status.percentUsed, Number(a.alertThresholdPercent) || null);
      if (!level) continue;
      const alertKey = `${b.id}|${start}|${end}|${level}`;
      const already = await this.prisma.auditLog.findFirst({ where: { familySpaceId: link.familySpaceId, action: 'telegram.budget_alert', metadata: { path: ['alertKey'], equals: alertKey } } });
      if (already) continue;
      const daysLeft = end === '9999-12-31' ? null : Math.max(0, Math.round((Date.parse(end) - Date.parse(today)) / 86400000));
      const text =
        level >= 100
          ? `🔴 <b>Бюджет «${escapeHtml(b.title)}» превышен</b>\nПотрачено ${rub(status.spent)} из ${rub(status.plannedExpense)} (${status.percentUsed}%), перерасход ${rub(-status.remaining)}.`
          : `🟡 <b>Бюджет «${escapeHtml(b.title)}»: ${status.percentUsed}%</b>\nПотрачено ${rub(status.spent)} из ${rub(status.plannedExpense)}, осталось ${rub(status.remaining)}${daysLeft !== null ? ` на ${daysLeft} дн.` : ''}.`;
      for (const chatId of chatIds) await this.client.sendMessage(chatId, text);
      await this.audit.log({
        familySpaceId: link.familySpaceId,
        actorUserId: link.userId,
        action: 'telegram.budget_alert',
        resourceType: 'budget',
        resourceId: b.id,
        metadata: { alertKey, level, percentUsed: status.percentUsed, chats: chatIds.length },
      });
    }
  }
}

export { addDaysIso };
