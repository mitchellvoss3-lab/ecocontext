// LLM provider abstraction — supports Anthropic, OpenAI, and Ollama
// Each provider maps to a "cheap" and "capable" model for routing

export interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  cachedPromptTokens?: number;
}

export interface LLMProvider {
  name: string;
  cheapModel: string;
  capableModel: string;
  chat(params: {
    model: string;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    maxTokens: number;
    cacheKey?: string;
  }): Promise<LLMResponse>;
}

function getStoredPreference(key: string): string | undefined {
  try {
    const { getPreference } = require('../store/knowledge.js') as { getPreference: (k: string) => string | undefined };
    return getPreference(key);
  } catch (_) {
    return undefined;
  }
}

function getApiKeyForProvider(provider: 'anthropic' | 'openai' | 'gemini'): string {
  const legacyStored = getStoredPreference('llm_api_key') ?? '';
  const anthropicStored = getStoredPreference('anthropic_api_key') ?? legacyStored;
  const openaiStored = getStoredPreference('openai_api_key') ?? legacyStored;
  const geminiStored = getStoredPreference('gemini_api_key') ?? legacyStored;

  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY ?? anthropicStored;
  if (provider === 'openai') return process.env.OPENAI_API_KEY ?? openaiStored;
  return process.env.GEMINI_API_KEY ?? geminiStored;
}

// --- Anthropic ---

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  cheapModel = 'claude-haiku-4-5-20251001';
  capableModel = 'claude-sonnet-4-6';

  private client: any;

  constructor() {
    const Anthropic = require('@anthropic-ai/sdk');
    this.client = new Anthropic({ apiKey: getApiKeyForProvider('anthropic') });
  }

  async chat(params: Parameters<LLMProvider['chat']>[0]): Promise<LLMResponse> {
    const res = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      cache_control: { type: 'ephemeral' },
      system: [
        {
          type: 'text',
          text: params.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: params.messages,
    });
    const text = res.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
    return {
      text,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      model: params.model,
      provider: this.name,
      cacheReadInputTokens: res.usage?.cache_read_input_tokens ?? 0,
      cacheWriteInputTokens: res.usage?.cache_creation_input_tokens ?? 0,
      cachedPromptTokens: (res.usage?.cache_read_input_tokens ?? 0) + (res.usage?.cache_creation_input_tokens ?? 0),
    };
  }
}

// --- OpenAI ---

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  cheapModel = 'gpt-4o-mini';
  capableModel = 'gpt-4o';

  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = getApiKeyForProvider('openai');
    this.baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  }

  async chat(params: Parameters<LLMProvider['chat']>[0]): Promise<LLMResponse> {
    const baseBody: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens,
      messages: [
        { role: 'system' as const, content: params.system },
        ...params.messages,
      ],
    };

    const cachedBody = {
      ...baseBody,
      prompt_cache_key: params.cacheKey,
      prompt_cache_retention: 'in_memory',
    };

    let res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(cachedBody),
    });

    if (!res.ok) {
      const firstErr = await res.text();
      const shouldRetryWithoutCache = res.status === 400
        && /prompt_cache|Unknown parameter|unrecognized/i.test(firstErr);

      if (shouldRetryWithoutCache) {
        res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(baseBody),
        });
      } else {
        throw new Error(`OpenAI API error ${res.status}: ${firstErr}`);
      }
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    const cachedPromptTokens = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      text: data.choices[0]?.message?.content ?? '',
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      model: params.model,
      provider: this.name,
      cachedPromptTokens,
      cacheReadInputTokens: cachedPromptTokens,
      cacheWriteInputTokens: 0,
    };
  }
}

// --- Google Gemini ---

export class GeminiProvider implements LLMProvider {
  name = 'gemini';
  cheapModel = 'gemini-2.5-flash-lite';
  capableModel = 'gemini-2.5-flash';

  private apiKey: string;

  constructor() {
    this.apiKey = getApiKeyForProvider('gemini');
  }

  async chat(params: Parameters<LLMProvider['chat']>[0]): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error('Gemini API key missing. Reset Provider Setup in Settings and enter a valid key from Google AI Studio (typically starts with AIza).');
    }

    // System instruction goes as a separate field
    const body: any = {
      contents: params.messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      systemInstruction: {
        parts: [{ text: params.system }],
      },
      generationConfig: {
        maxOutputTokens: params.maxTokens,
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      if (res.status === 429) {
        throw new Error(
          'Gemini quota exceeded for this key/project. Your quota appears to be 0 for the selected model. ' +
          'Use Settings -> Reset Provider Setup to switch to Ollama/OpenAI/Anthropic, or enable Gemini billing/quota in Google AI Studio/Cloud and try again.'
        );
      }
      throw new Error(`Gemini API error ${res.status}: ${err}`);
    }
    const data = await res.json();

    const text = data.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text)
      ?.join('') ?? '';

    const usage = data.usageMetadata ?? {};

    return {
      text,
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
      model: params.model,
      provider: this.name,
    };
  }
}

// --- Ollama (local) ---

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  cheapModel = 'llama3.2:3b';
  capableModel = 'llama3.1:8b';

  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  }

  async chat(params: Parameters<LLMProvider['chat']>[0]): Promise<LLMResponse> {
    const body = {
      model: params.model,
      stream: false,
      messages: [
        { role: 'system', content: params.system },
        ...params.messages,
      ],
    };
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama error ${res.status}: ${err}`);
    }
    const data = await res.json();
    return {
      text: data.message?.content ?? '',
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      model: params.model,
      provider: this.name,
    };
  }
}

// --- Provider registry ---

const providers: Record<string, () => LLMProvider> = {
  anthropic: () => new AnthropicProvider(),
  openai: () => new OpenAIProvider(),
  gemini: () => new GeminiProvider(),
  ollama: () => new OllamaProvider(),
};

let activeProvider: LLMProvider | null = null;
let activeProviderName: string | null = null;

export function getProvider(name?: string): LLMProvider {
  const requested = name ?? detectProvider();
  if (activeProvider && activeProviderName === requested) return activeProvider;

  const factory = providers[requested];
  if (!factory) throw new Error(`Unknown provider: ${requested}. Available: ${Object.keys(providers).join(', ')}`);

  activeProvider = factory();
  activeProviderName = requested;
  return activeProvider;
}

export function detectProvider(): string {
  // Check user preference from database first
  try {
    const { getPreference } = require('../store/knowledge.js') as { getPreference: (k: string) => string | undefined };
    const storedProvider = getPreference('llm_provider');
    if (storedProvider) return storedProvider;
  } catch (_) {
    // If store not available yet, continue to env/auto-detect
  }

  // Check explicit environment preference
  if (process.env.LLM_PROVIDER) return process.env.LLM_PROVIDER;

  // Auto-detect from available keys
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';

  // Default to ollama (no key needed)
  return 'ollama';
}

export function listProviders(): string[] {
  return Object.keys(providers);
}
