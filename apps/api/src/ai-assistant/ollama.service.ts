import { Injectable, Logger } from '@nestjs/common';
import { FieldSchema } from '../entity-types/field-schema.types';

export interface LlmFieldExtractionResult {
  attributes: Record<string, unknown>;
  fieldConfidence: Record<string, number>;
  /** true, если запрос вообще не удался (Ollama недоступен/таймаут) — в
   * отличие от "успешно ответил, но не нашёл значения" (это просто пустой attributes). */
  unavailable: boolean;
}

/**
 * Интеграция с локальной моделью через Ollama (обсуждалось отдельно —
 * реально протестировано на вашем ThinkPad: qwen3:8b, ~23 сек/запрос без
 * режима размышления, ~2 ядра CPU, ~6 ГБ RAM). Работает СТРОГО как
 * дополнение к regex-извлечению document-classifier.ts, а не замена:
 *
 *   - если OLLAMA_URL не задан в окружении — сервис не делает НИ ОДНОГО
 *     сетевого вызова, весь конвейер OCR работает как раньше;
 *   - если Ollama недоступен/не ответил за разумное время — тихий откат,
 *     без падения обработки документа;
 *   - предложенные LLM значения проходят ТОТ ЖЕ конвейер подтверждения
 *     пользователем, что и обычный regex-OCR — никогда не считаются
 *     истиной автоматически (тот же принцип, что для OCR в целом).
 */
@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);
  private readonly baseUrl = process.env.OLLAMA_URL; // например http://host.docker.internal:11434
  private readonly model = process.env.OLLAMA_MODEL ?? 'qwen3:8b';
  private readonly timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 60000);

  isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  /**
   * Просит модель извлечь значения полей заданного типа документа из уже
   * распознанного OCR-текста (сама модель картинки не видит и не
   * распознаёт — это работа Tesseract, LLM работает только с текстом).
   * Используется как ДОПОЛНЕНИЕ к regex-правилам document-classifier.ts:
   * заполняет поля, которые эвристика не смогла найти (нестандартные
   * формулировки, документы без специализированных regex-правил).
   */
  async extractFields(
    entityType: string,
    fields: FieldSchema[],
    ocrText: string,
  ): Promise<LlmFieldExtractionResult> {
    if (!this.isConfigured()) {
      return { attributes: {}, fieldConfidence: {}, unavailable: true };
    }
    if (fields.length === 0 || !ocrText.trim()) {
      return { attributes: {}, fieldConfidence: {}, unavailable: false };
    }

    const prompt = buildExtractionPrompt(entityType, fields, ocrText);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          think: false, // без режима размышления — на порядок быстрее, для извлечения полей рассуждения не нужны
          stream: false,
          format: 'json',
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        this.logger.warn(`Ollama ответил ${response.status} — пропускаем LLM-извлечение для этого документа`);
        return { attributes: {}, fieldConfidence: {}, unavailable: true };
      }

      const data = (await response.json()) as { response?: string };
      return parseExtractionResponse(data.response ?? '', fields);
    } catch (err) {
      // Таймаут, недоступность Ollama, сбой сети — не роняем обработку документа.
      this.logger.warn(`LLM-извлечение недоступно: ${(err as Error).message}`);
      return { attributes: {}, fieldConfidence: {}, unavailable: true };
    }
  }
}

/** Собирает промпт с чётким требованием вернуть только JSON по заданным ключам —
 * без придумывания значений, которых нет в тексте (тот же принцип "не угадывать",
 * что и в остальной системе). */
export function buildExtractionPrompt(entityType: string, fields: FieldSchema[], ocrText: string): string {
  const fieldList = fields
    .filter((f) => f.type !== 'link') // ссылки на другие сущности LLM по тексту не подберёт надёжно
    .map((f) => `- "${f.key}" (${f.label}, тип: ${f.type})`)
    .join('\n');

  return [
    `Ты помогаешь извлечь данные из распознанного OCR-текста документа типа "${entityType}".`,
    `Ниже — поля, которые нужно попытаться найти в тексте:`,
    fieldList,
    ``,
    `ПРАВИЛА:`,
    `1. Отвечай ТОЛЬКО валидным JSON-объектом, без пояснений и markdown.`,
    `2. Ключи JSON — ровно из списка выше, плюс не более 20 символов.`,
    `3. Если значение поля не удаётся найти в тексте — НЕ включай этот ключ в ответ вообще. Никогда не выдумывай значения.`,
    `4. Для дат используй формат ГГГГ-ММ-ДД.`,
    `5. Для чисел — только цифры и точку, без пробелов и валютных символов.`,
    ``,
    `Текст документа:`,
    `"""`,
    ocrText.slice(0, 6000), // ограничение на длину — экономим время генерации на длинных документах
    `"""`,
    ``,
    `JSON:`,
  ].join('\n');
}

/** Разбирает ответ модели, отбрасывая всё, что не относится к запрошенным полям
 * (LLM иногда добавляет лишние ключи или комментарии несмотря на инструкцию). */
export function parseExtractionResponse(rawResponse: string, fields: FieldSchema[]): LlmFieldExtractionResult {
  const allowedKeys = new Set(fields.map((f) => f.key));
  const attributes: Record<string, unknown> = {};
  const fieldConfidence: Record<string, number> = {};

  try {
    // Модель иногда оборачивает JSON в ```json ... ``` несмотря на инструкцию — снимаем обёртку.
    const cleaned = rawResponse.replace(/```json\s*|\s*```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { attributes: {}, fieldConfidence: {}, unavailable: false };
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (!allowedKeys.has(key)) continue; // модель предложила лишнее поле — игнорируем
      if (value === null || value === undefined || value === '') continue;
      attributes[key] = value;
      // Фиксированная умеренная уверенность для LLM-предположений — ниже,
      // чем у уверенного regex-совпадения, поэтому UI подсветит поле как
      // требующее особого внимания при подтверждении.
      fieldConfidence[key] = 0.55;
    }
  } catch {
    return { attributes: {}, fieldConfidence: {}, unavailable: false };
  }

  return { attributes, fieldConfidence, unavailable: false };
}
