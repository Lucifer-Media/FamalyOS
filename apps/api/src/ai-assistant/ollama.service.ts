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
 * Интеграция с локальной LLM. Изначально протестировано с Ollama на вашем
 * ThinkPad (qwen3:8b, ~23 сек/запрос без режима размышления, ~2 ядра CPU,
 * ~6 ГБ RAM). Позже добавлена поддержка LM Studio (и вообще любого
 * OpenAI-совместимого сервера — vLLM, llama.cpp server и т.п.) — у него
 * другой формат запроса (`/v1/chat/completions` с `messages`, а не
 * Ollama-шный `/api/generate` с одним `prompt`). Класс называется
 * `OllamaService` по историческим причинам (не переименован, чтобы не
 * трогать три места, где он используется — ai-chat.service.ts,
 * ocr.processor.ts, ai-assistant.module.ts), но фактически теперь это
 * универсальный клиент локальной LLM, провайдер выбирается через
 * `LLM_PROVIDER`.
 *
 * Работает СТРОГО как дополнение к regex-извлечению document-classifier.ts,
 * а не замена:
 *   - если ни один URL не задан в окружении — сервис не делает НИ ОДНОГО
 *     сетевого вызова, весь конвейер OCR работает как раньше;
 *   - если сервер недоступен/не ответил за разумное время — тихий откат,
 *     без падения обработки документа;
 *   - предложенные LLM значения проходят ТОТ ЖЕ конвейер подтверждения
 *     пользователем, что и обычный regex-OCR — никогда не считаются
 *     истиной автоматически (тот же принцип, что для OCR в целом).
 *
 * Переменные окружения (у каждой есть старое имя `OLLAMA_*` как фолбэк —
 * если у вас уже настроен Ollama через старые переменные, ничего менять
 * не нужно):
 *   - `LLM_PROVIDER` — 'ollama' (по умолчанию) | 'openai_compatible' (LM Studio и т.п.)
 *   - `LLM_URL` (или `OLLAMA_URL`) — например `http://100.71.172.64:1234` для LM Studio
 *   - `LLM_FALLBACK_URL` (или `OLLAMA_FALLBACK_URL`) — резервный адрес
 *   - `LLM_MODEL` (или `OLLAMA_MODEL`) — например `qwen/qwen3.6-35b-a3b` для LM Studio
 *   - `LLM_API_KEY` — опционально, Bearer-токен (LM Studio обычно не требует)
 *   - `LLM_TIMEOUT_MS` (или `OLLAMA_TIMEOUT_MS`)
 */
/**
 * Возвращает первое непустое значение — используется вместо `??`, потому
 * что Docker Compose при `${VAR:-}` передаёт в контейнер пустую строку
 * `""` для незаданной переменной (а не отсутствие переменной вовсе), а
 * `??` пустую строку не считает "нет значения" — фолбэк на старое имя
 * переменной (`OLLAMA_URL` и т.п.) иначе молча переставал бы работать
 * при любом упоминании новых `LLM_*` имён в docker-compose.yml.
 */
function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.find((v) => v !== undefined && v !== '');
}

export type LlmProvider = 'ollama' | 'openai_compatible';

/** Один адрес LLM в цепочке (основной → резервный). У каждого — свой тип API и модель. */
export interface LlmEndpoint {
  role: 'primary' | 'fallback';
  url: string;
  provider: LlmProvider;
  model: string;
}

export interface LlmCompletion {
  text: string;
  endpoint: LlmEndpoint;
  durationMs: number;
}

export interface LlmEndpointStatus extends LlmEndpoint {
  reachable: boolean;
  latencyMs: number | null;
  /** Модель есть в списке моделей сервера (null — сервер список не вернул). */
  modelAvailable: boolean | null;
  error?: string;
}

/** Qwen3 и другие «думающие» модели через OpenAI-совместимый API могут вернуть блок <think>…</think> — пользователю он не нужен. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);
  private readonly provider = (firstNonEmpty(process.env.LLM_PROVIDER) ?? 'ollama') as LlmProvider;
  private readonly baseUrl = firstNonEmpty(process.env.LLM_URL, process.env.OLLAMA_URL); // например http://100.x.x.x:11434 (Ollama) или http://100.x.x.x:1234 (LM Studio)
  // Резервный адрес — если основной (например, более мощный домашний ПК)
  // недоступен или не ответил вовремя, пробуем запасной (например, тот же
  // ThinkPad). Полностью опционально — если не задан, просто нет резерва.
  // Итерация 4: у резервного адреса может быть СВОЙ тип API и СВОЯ модель
  // (LLM_FALLBACK_PROVIDER / LLM_FALLBACK_MODEL) — типичная схема «LM Studio
  // на ПК → Ollama на ноутбуке». Если не заданы — как раньше, наследуются от основного.
  private readonly fallbackUrl = firstNonEmpty(process.env.LLM_FALLBACK_URL, process.env.OLLAMA_FALLBACK_URL);
  private readonly fallbackProvider = (firstNonEmpty(process.env.LLM_FALLBACK_PROVIDER) ?? this.provider) as LlmProvider;
  private readonly model = firstNonEmpty(process.env.LLM_MODEL, process.env.OLLAMA_MODEL) ?? 'qwen3:8b';
  private readonly fallbackModel = firstNonEmpty(process.env.LLM_FALLBACK_MODEL) ?? this.model;
  private readonly apiKey = firstNonEmpty(process.env.LLM_API_KEY);
  private readonly timeoutMs = Number(firstNonEmpty(process.env.LLM_TIMEOUT_MS, process.env.OLLAMA_TIMEOUT_MS) ?? 60000);

  isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  /** Цепочка адресов в порядке попыток. */
  endpoints(): LlmEndpoint[] {
    const list: LlmEndpoint[] = [];
    if (this.baseUrl) list.push({ role: 'primary', url: this.baseUrl, provider: this.provider, model: this.model });
    if (this.fallbackUrl) list.push({ role: 'fallback', url: this.fallbackUrl, provider: this.fallbackProvider, model: this.fallbackModel });
    return list;
  }

  /**
   * Отправляет один запрос на генерацию. Пробует адреса по цепочке; на выходе —
   * текст и то, КАКАЯ модель ответила (показывается в отчётах). null — никто не ответил.
   */
  async complete(prompt: string, opts: { json?: boolean; timeoutMs?: number } = {}): Promise<LlmCompletion | null> {
    const chain = this.endpoints();
    for (let i = 0; i < chain.length; i++) {
      const ep = chain[i];
      const hasNext = i < chain.length - 1;
      const controller = new AbortController();
      const started = Date.now();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.timeoutMs);
      try {
        const response =
          ep.provider === 'openai_compatible'
            ? await fetch(`${ep.url}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
                },
                body: JSON.stringify({
                  model: ep.model,
                  messages: [{ role: 'user', content: prompt }],
                  stream: false,
                  ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
                }),
                signal: controller.signal,
              })
            : await fetch(`${ep.url}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: ep.model,
                  prompt,
                  think: false, // без режима размышления — на порядок быстрее, рассуждения тут не нужны
                  stream: false,
                  ...(opts.json ? { format: 'json' } : {}),
                }),
                signal: controller.signal,
              });

        clearTimeout(timer);
        if (!response.ok) {
          this.logger.warn(`LLM (${ep.url}) ответил ${response.status}${hasNext ? ' — пробуем резервный адрес' : ''}`);
          continue;
        }

        let text: string | undefined;
        if (ep.provider === 'openai_compatible') {
          const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
          text = data.choices?.[0]?.message?.content;
        } else {
          const data = (await response.json()) as { response?: string };
          text = data.response;
        }
        if (text === undefined || text === null) return null;
        return { text: stripThinking(text), endpoint: ep, durationMs: Date.now() - started };
      } catch (err) {
        clearTimeout(timer);
        this.logger.warn(`LLM (${ep.url}) недоступен: ${(err as Error).message}${hasNext ? ' — пробуем резервный адрес' : ''}`);
      }
    }
    return null;
  }

  /** Совместимость со старым кодом (chat/extractFields): только текст. */
  private async generate(prompt: string, opts: { json?: boolean } = {}): Promise<string | null> {
    const result = await this.complete(prompt, opts);
    return result ? result.text : null;
  }

  /** Проверка доступности каждого адреса цепочки (экран «Статус ИИ»). Ничего не генерирует. */
  async status(): Promise<LlmEndpointStatus[]> {
    return Promise.all(
      this.endpoints().map(async (ep) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const started = Date.now();
        try {
          const res = await fetch(ep.provider === 'openai_compatible' ? `${ep.url}/v1/models` : `${ep.url}/api/tags`, {
            headers: this.apiKey && ep.provider === 'openai_compatible' ? { Authorization: `Bearer ${this.apiKey}` } : {},
            signal: controller.signal,
          });
          clearTimeout(timer);
          const latencyMs = Date.now() - started;
          if (!res.ok) return { ...ep, reachable: false, latencyMs, modelAvailable: null, error: `HTTP ${res.status}` };
          let modelAvailable: boolean | null = null;
          try {
            const data = (await res.json()) as { models?: { name?: string; model?: string }[]; data?: { id?: string }[] };
            const names =
              ep.provider === 'openai_compatible'
                ? (data.data ?? []).map((m) => m.id ?? '')
                : (data.models ?? []).map((m) => m.name ?? m.model ?? '');
            if (names.length) modelAvailable = names.some((n) => n === ep.model || n.startsWith(ep.model + ':') || ep.model.startsWith(n));
          } catch {
            modelAvailable = null;
          }
          return { ...ep, reachable: true, latencyMs, modelAvailable };
        } catch (err) {
          clearTimeout(timer);
          return { ...ep, reachable: false, latencyMs: null, modelAvailable: null, error: (err as Error).message };
        }
      }),
    );
  }

  /**
   * Семейный ИИ-ассистент — отвечает на вопрос, опираясь ТОЛЬКО на
   * переданные фрагменты контекста (найденные полнотекстовым поиском по
   * реальным данным семьи, см. AiChatService). Модель НЕ имеет доступа к
   * интернету и не должна выдумывать факты за пределами контекста — это
   * прямо прописано в промпте. Источники (какие документы использовались)
   * возвращаются отдельно самим AiChatService, не моделью — так надёжнее,
   * чем просить модель их процитировать.
   */
  async chat(question: string, contextChunks: { title: string; entityType: string; text: string }[]): Promise<string | null> {
    if (!this.isConfigured()) return null;

    const contextBlock = contextChunks
      .map((c, i) => `[Источник ${i + 1}: ${c.title} (${c.entityType})]\n${c.text.slice(0, 1500)}`)
      .join('\n\n');

    const prompt = [
      'Ты — семейный ИИ-ассистент Family OS. Отвечай на вопрос пользователя ТОЛЬКО на основе',
      'приведённых ниже источников из его личной базы данных (документы, финансы, медицина и т.д.).',
      '',
      'ПРАВИЛА:',
      '1. Если ответа нет в источниках — прямо скажи, что не нашёл такую информацию. НЕ выдумывай.',
      '2. Отвечай кратко и по делу, на русском языке.',
      '3. Не придумывай номера документов, даты, суммы — используй только то, что реально есть в источниках.',
      '',
      contextChunks.length > 0 ? `Источники:\n${contextBlock}` : 'Источников не найдено — сообщи об этом пользователю.',
      '',
      `Вопрос пользователя: ${question}`,
      '',
      'Ответ:',
    ].join('\n');

    return this.generate(prompt);
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
    const text = await this.generate(prompt, { json: true });
    if (text === null) {
      return { attributes: {}, fieldConfidence: {}, unavailable: true };
    }
    return parseExtractionResponse(text, fields);
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
