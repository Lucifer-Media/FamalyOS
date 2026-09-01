import { Injectable, ServiceUnavailableException, Logger } from '@nestjs/common';
import { SearchService } from '../search/search.service';
import { OllamaService } from './ollama.service';
import { PrismaService } from '../common/prisma.service';
import { detectTopicEntityTypes, summarizeAttributes } from './chat-topic-detection';

export interface ChatSource {
  id: string;
  entityType: string;
  title: string;
  url: string;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
}

// Модель работает с ограниченным контекстным окном (у qwen3:8b по умолчанию
// в Ollama — 4096 токенов). Реальный случай на практике: широкий вопрос
// ("проанализируй все операции за месяц") пытался утрамбовать до 20 записей
// по 1500 символов — это ~7500+ токенов, окно переполнялось, и запрос падал
// с необработанной ошибкой. Здесь — жёсткие лимиты, чтобы контекст всегда
// помещался с запасом.
const MAX_CONTEXT_CHUNKS = 10;
const MAX_CHUNK_CHARS = 300;

/**
 * Семейный ИИ-ассистент, отвечающий на вопросы по данным, реально
 * загруженным в Family OS. Гибридная схема поиска контекста:
 *   1) полнотекстовый поиск (хорош для "найди договор с Ивановым");
 *   2) + прямая выборка последних записей по теме вопроса;
 *   3) + для финансовых вопросов — предварительная агрегация (сумма
 *      доходов/расходов по категориям) СЧИТАЕТСЯ КОДОМ, а не моделью:
 *      LLM ненадёжно складывает десятки чисел в уме, а точная сумма —
 *      это именно тот случай, где нельзя допускать "почти правильно".
 */
@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    private readonly search: SearchService,
    private readonly ollama: OllamaService,
    private readonly prisma: PrismaService,
  ) {}

  async ask(userId: string, familySpaceId: string, question: string): Promise<ChatResponse> {
    if (!this.ollama.isConfigured()) {
      throw new ServiceUnavailableException(
        'ИИ-ассистент не настроен на этом сервере (не задан OLLAMA_URL) — обратитесь к администратору.',
      );
    }

    try {
      const searchHits = await this.search.search(userId, familySpaceId, question, undefined, 6);

      const topicTypes = detectTopicEntityTypes(question);
      const topicHits =
        topicTypes.length > 0
          ? await this.prisma.entity.findMany({
              where: { familySpaceId, entityType: { in: topicTypes }, status: 'ACTIVE' },
              orderBy: { updatedAt: 'desc' },
              take: 8,
            })
          : [];

      const seenIds = new Set(searchHits.map((h) => h.id));
      const combinedHits = [
        ...searchHits,
        ...topicHits
          .filter((e: { id: string }) => !seenIds.has(e.id))
          .map((e: { id: string; entityType: string; title: string; attributes: unknown }) => ({
            id: e.id,
            entityType: e.entityType,
            title: e.title,
            snippet: summarizeAttributes(e.attributes as Record<string, unknown>).slice(0, MAX_CHUNK_CHARS),
            rank: 0,
            updatedAt: new Date(),
          })),
      ].slice(0, MAX_CONTEXT_CHUNKS);

      const contextChunks = combinedHits.map((h) => ({
        title: h.title,
        entityType: h.entityType,
        text: h.snippet.slice(0, MAX_CHUNK_CHARS),
      }));

      // Для финансовых вопросов — точная сумма считается кодом и
      // добавляется отдельным, приоритетным блоком контекста.
      if (topicTypes.includes('financial_transaction')) {
        const summary = await this.buildFinancialSummary(familySpaceId);
        if (summary) contextChunks.unshift(summary);
      }

      const answer = await this.ollama.chat(question, contextChunks);

      if (answer === null) {
        throw new ServiceUnavailableException(
          'ИИ-ассистент не ответил (сервер Ollama недоступен, модель не установлена или превышено время ожидания).',
        );
      }

      const sources: ChatSource[] = combinedHits.map((h) => ({
        id: h.id,
        entityType: h.entityType,
        title: h.title,
        url: routeForEntity(h.id, h.entityType),
      }));

      return { answer, sources };
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      // Любая иная непредвиденная ошибка — не отдаём голую 500-ю без
      // объяснения, логируем и возвращаем понятный ответ.
      this.logger.error(`Ошибка обработки вопроса ассистента: ${(err as Error).message}`, (err as Error).stack);
      throw new ServiceUnavailableException('Не удалось обработать вопрос — попробуйте переформулировать короче.');
    }
  }

  /** Точная агрегация доходов/расходов по категориям за последние 90 дней —
   * считается кодом, не моделью, чтобы суммы были гарантированно верными. */
  private async buildFinancialSummary(
    familySpaceId: string,
  ): Promise<{ title: string; entityType: string; text: string } | null> {
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const sinceIso = since.toISOString().slice(0, 10);

    const transactions = await this.prisma.entity.findMany({
      where: { familySpaceId, entityType: 'financial_transaction', status: 'ACTIVE' },
      select: { attributes: true },
    });

    const byCategory = new Map<string, number>();
    let totalIncome = 0;
    let totalExpense = 0;
    let count = 0;

    for (const tx of transactions) {
      const a = tx.attributes as Record<string, unknown>;
      const date = String(a.date ?? '');
      if (!date || date < sinceIso) continue;
      const amount = Number(a.amount) || 0;
      if (amount >= 0) totalIncome += amount;
      else totalExpense += Math.abs(amount);
      const category = (a.category as string) || 'Без категории';
      byCategory.set(category, (byCategory.get(category) ?? 0) + (amount < 0 ? Math.abs(amount) : 0));
      count++;
    }

    if (count === 0) return null;

    const topCategories = Array.from(byCategory.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([cat, sum]) => `${cat}: ${Math.round(sum)}`)
      .join(', ');

    return {
      title: 'Точная сводка по операциям за последние 90 дней (посчитано кодом, не моделью)',
      entityType: 'summary',
      text: `Всего операций: ${count}. Доходы: ${Math.round(totalIncome)}. Расходы: ${Math.round(totalExpense)}. По категориям расходов: ${topCategories}`,
    };
  }
}

function routeForEntity(id: string, entityType: string): string {
  if (entityType === 'passport_rf') return `/documents/passport-rf/${id}`;
  return `/documents/${entityType}/${id}`;
}
