import { OllamaService } from '../ollama.service';

const ORIGINAL_ENV = process.env;

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  process.env = { ...ORIGINAL_ENV, ...vars };
  try {
    fn();
  } finally {
    process.env = ORIGINAL_ENV;
  }
}

describe('OllamaService — провайдер Ollama (по умолчанию, формат /api/generate)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('chat() отправляет prompt в формате Ollama и разбирает поле response', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;
    global.fetch = jest.fn(async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ response: 'Привет от Ollama' }) } as any;
    }) as any;

    await withEnv({ OLLAMA_URL: 'http://home:11434', LLM_PROVIDER: undefined }, async () => {
      const service = new OllamaService();
      const answer = await service.chat('Вопрос?', []);
      expect(answer).toBe('Привет от Ollama');
      expect(capturedUrl).toBe('http://home:11434/api/generate');
      expect(capturedBody.stream).toBe(false);
      expect(capturedBody.think).toBe(false);
      expect(typeof capturedBody.prompt).toBe('string');
    });
  });

  it('isConfigured() учитывает и новое имя LLM_URL, и старое OLLAMA_URL', () => {
    withEnv({ OLLAMA_URL: undefined, LLM_URL: undefined }, () => {
      expect(new OllamaService().isConfigured()).toBe(false);
    });
    withEnv({ OLLAMA_URL: 'http://x:11434', LLM_URL: undefined }, () => {
      expect(new OllamaService().isConfigured()).toBe(true);
    });
  });

  it('РЕГРЕССИЯ: пустая строка LLM_URL (как её передаёт docker-compose для незаданной переменной ${LLM_URL:-}) не должна перебивать OLLAMA_URL', async () => {
    let capturedUrl = '';
    global.fetch = jest.fn(async (url: any) => {
      capturedUrl = String(url);
      return { ok: true, json: async () => ({ response: 'ok' }) } as any;
    }) as any;

    await withEnv({ LLM_URL: '', OLLAMA_URL: 'http://home:11434' }, async () => {
      const service = new OllamaService();
      expect(service.isConfigured()).toBe(true);
      await service.chat('Вопрос?', []);
      expect(capturedUrl).toBe('http://home:11434/api/generate');
    });
  });
});

describe('OllamaService — провайдер openai_compatible (LM Studio и т.п.)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('chat() отправляет messages в формате OpenAI на /v1/chat/completions и разбирает choices[0].message.content', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;
    let capturedHeaders: any = null;
    global.fetch = jest.fn(async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init.body);
      capturedHeaders = init.headers;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Привет от LM Studio' } }] }) } as any;
    }) as any;

    await withEnv(
      { LLM_PROVIDER: 'openai_compatible', LLM_URL: 'http://100.71.172.64:1234', LLM_MODEL: 'qwen/qwen3.6-35b-a3b', OLLAMA_URL: undefined },
      async () => {
        const service = new OllamaService();
        const answer = await service.chat('Вопрос?', []);
        expect(answer).toBe('Привет от LM Studio');
        expect(capturedUrl).toBe('http://100.71.172.64:1234/v1/chat/completions');
        expect(capturedBody.model).toBe('qwen/qwen3.6-35b-a3b');
        expect(capturedBody.messages).toEqual([{ role: 'user', content: expect.any(String) }]);
        expect(capturedBody.stream).toBe(false);
        expect(capturedHeaders.Authorization).toBeUndefined(); // без LLM_API_KEY заголовка быть не должно
      },
    );
  });

  it('добавляет заголовок Authorization, если задан LLM_API_KEY', async () => {
    let capturedHeaders: any = null;
    global.fetch = jest.fn(async (_url: any, init: any) => {
      capturedHeaders = init.headers;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) } as any;
    }) as any;

    await withEnv(
      { LLM_PROVIDER: 'openai_compatible', LLM_URL: 'http://100.71.172.64:1234', LLM_API_KEY: 'secret-key', OLLAMA_URL: undefined },
      async () => {
        await new OllamaService().chat('Вопрос?', []);
        expect(capturedHeaders.Authorization).toBe('Bearer secret-key');
      },
    );
  });

  it('extractFields() запрашивает response_format json_object и парсит JSON из content', async () => {
    global.fetch = jest.fn(async () =>
      ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"period": "2026-06"}' } }] }) }) as any,
    ) as any;

    await withEnv({ LLM_PROVIDER: 'openai_compatible', LLM_URL: 'http://100.71.172.64:1234', OLLAMA_URL: undefined }, async () => {
      const service = new OllamaService();
      const result = await service.extractFields('utility_bill', [{ key: 'period', label: 'Период', type: 'string' }], 'какой-то текст');
      expect(result.attributes).toEqual({ period: '2026-06' });
      expect(result.unavailable).toBe(false);
    });
  });

  it('при недоступности основного адреса пробует LLM_FALLBACK_URL', async () => {
    const calledUrls: string[] = [];
    global.fetch = jest.fn(async (url: any) => {
      calledUrls.push(String(url));
      if (String(url).startsWith('http://primary')) throw new Error('ECONNREFUSED');
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok из резерва' } }] }) } as any;
    }) as any;

    await withEnv(
      { LLM_PROVIDER: 'openai_compatible', LLM_URL: 'http://primary:1234', LLM_FALLBACK_URL: 'http://fallback:1234', OLLAMA_URL: undefined },
      async () => {
        const answer = await new OllamaService().chat('Вопрос?', []);
        expect(answer).toBe('ok из резерва');
        expect(calledUrls).toEqual(['http://primary:1234/v1/chat/completions', 'http://fallback:1234/v1/chat/completions']);
      },
    );
  });

  it('возвращает null, если ни основной, ни резервный адрес не ответили', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('таймаут');
    }) as any;

    await withEnv({ LLM_PROVIDER: 'openai_compatible', LLM_URL: 'http://x:1234', OLLAMA_URL: undefined }, async () => {
      const answer = await new OllamaService().chat('Вопрос?', []);
      expect(answer).toBeNull();
    });
  });
});
