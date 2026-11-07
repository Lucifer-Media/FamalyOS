import { Logger } from '@nestjs/common';

/**
 * Минимальный клиент Telegram Bot API на встроенном fetch — без новых
 * зависимостей. Работает через long polling (getUpdates): серверу НЕ нужен
 * публичный HTTPS-адрес и открытые порты — только исходящий доступ к
 * api.telegram.org (или к TELEGRAM_API_URL, если Telegram доступен через
 * свой прокси/зеркало Bot API).
 */

export interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
}
export interface TgChat {
  id: number;
  type: string;
  title?: string;
}
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  date: number;
  migrate_to_chat_id?: number;
}
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}
export interface InlineButton {
  text: string;
  callback_data: string;
}
export type InlineKeyboard = InlineButton[][];

export interface TelegramClient {
  getMe(): Promise<TgUser | null>;
  getUpdates(offset: number, timeoutSec: number): Promise<TgUpdate[]>;
  sendMessage(chatId: number | string, text: string, keyboard?: InlineKeyboard): Promise<TgMessage | null>;
  editMessage(chatId: number | string, messageId: number, text: string, keyboard?: InlineKeyboard): Promise<void>;
  answerCallback(id: string, text?: string): Promise<void>;
  setMyCommands(commands: { command: string; description: string }[]): Promise<void>;
  deleteWebhook(): Promise<void>;
}

export class HttpTelegramClient implements TelegramClient {
  private readonly logger = new Logger('TelegramApi');
  constructor(
    private readonly token: string,
    private readonly baseUrl = 'https://api.telegram.org',
  ) {}

  private async call<T>(method: string, body: Record<string, unknown>, timeoutMs = 15000): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
      if (!data.ok) {
        // «message is not modified» — штатная ситуация при повторном нажатии кнопки.
        if (!/not modified/i.test(data.description ?? '')) this.logger.warn(`${method}: ${data.description}`);
        return null;
      }
      return data.result ?? null;
    } finally {
      clearTimeout(timer);
    }
  }

  getMe() {
    return this.call<TgUser>('getMe', {});
  }
  async getUpdates(offset: number, timeoutSec: number) {
    return (await this.call<TgUpdate[]>('getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] }, (timeoutSec + 10) * 1000)) ?? [];
  }
  sendMessage(chatId: number | string, text: string, keyboard?: InlineKeyboard) {
    return this.call<TgMessage>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }
  async editMessage(chatId: number | string, messageId: number, text: string, keyboard?: InlineKeyboard) {
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: keyboard ?? [] },
    });
  }
  async answerCallback(id: string, text?: string) {
    await this.call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) });
  }
  async setMyCommands(commands: { command: string; description: string }[]) {
    await this.call('setMyCommands', { commands });
  }
  async deleteWebhook() {
    await this.call('deleteWebhook', { drop_pending_updates: false });
  }
}
