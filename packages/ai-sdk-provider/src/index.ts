import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';

/**
 * AI Stupid Level Smart Router for the Vercel AI SDK.
 *
 * ```ts
 * import { generateText } from 'ai';
 * import { asl } from '@aistupidlevel/ai-sdk-provider';
 *
 * const { text, providerMetadata } = await generateText({ model: asl('auto-coding'), prompt: 'Fix this bug…' });
 * providerMetadata?.aistupidlevel; // { model: 'claude-opus-5-5', provider: 'anthropic' } — who answered
 * ```
 */

export const VERSION = '0.1.0';
export const DEFAULT_BASE_URL = 'https://aistupidlevel.info/v1';

/** Routing modes; "auto" uses the preference saved on your account. Any model id pins that model. */
export type ASLRoutingMode =
  | 'auto' | 'auto-best' | 'auto-coding' | 'auto-reasoning' | 'auto-tooling' | 'auto-agentic'
  | 'auto-value' | 'auto-value-coding' | 'auto-value-reasoning' | 'auto-value-tooling' | 'auto-value-agentic'
  | 'auto-consistent' | 'auto-fastest-quality' | 'auto-fastest' | 'auto-cheapest' | 'auto-task' | 'auto-split';
export type ASLChatModelId = ASLRoutingMode | (string & {});
export type ASLEmbeddingModelId = 'auto-embedding' | 'text-embedding-3-small' | 'text-embedding-3-large' | (string & {});

type FetchFunction = typeof globalThis.fetch;

export interface ASLProviderSettings {
  /** Router key (aism_…). Read from ASL_ROUTER_KEY at request time when omitted. */
  apiKey?: string;
  /** Defaults to https://aistupidlevel.info/v1 (or ASL_BASE_URL). */
  baseURL?: string;
  /**
   * Sandbox: real routing, a deterministic mock answer, no provider called, nothing spent.
   * For tests and for trying the router before adding provider keys.
   */
  sandbox?: boolean;
  /** Extra headers for every request. */
  headers?: Record<string, string>;
  /** Custom fetch. */
  fetch?: FetchFunction;
}

/** Who answered: the model and provider the router chose. In `providerMetadata.aistupidlevel`. */
export interface ASLRoutingMetadata {
  model: string | null;
  provider: string | null;
}

/** The full routing decision, from a result's response headers (see routingFromResponse). */
export interface ASLRoutingInfo extends ASLRoutingMetadata {
  reasoning: string | null;
  requestId: string | null;
  sandbox: boolean;
  fallback: boolean;
}

const env = (name: string): string | undefined => {
  try { return (globalThis as any).process?.env?.[name] || undefined; } catch { return undefined; }
};

/** "aism_v1_anthropic" → "anthropic". */
const providerOf = (fingerprint: unknown): string | null =>
  typeof fingerprint === 'string' && fingerprint.startsWith('aism_v1_') ? fingerprint.slice('aism_v1_'.length) : null;

const metadataExtractor = {
  async extractMetadata({ parsedBody }: { parsedBody: unknown }) {
    const b = parsedBody as any;
    if (!b || typeof b !== 'object') return undefined;
    return { aistupidlevel: { model: b.model ?? null, provider: providerOf(b.system_fingerprint) } };
  },
  createStreamExtractor() {
    let model: string | null = null;
    let provider: string | null = null;
    return {
      processChunk(chunk: unknown) {
        const c = chunk as any;
        if (c && typeof c === 'object') {
          model = model ?? c.model ?? null;
          provider = provider ?? providerOf(c.system_fingerprint);
        }
      },
      buildMetadata() {
        return { aistupidlevel: { model, provider } };
      },
    };
  },
};

/** Create a provider instance. `asl` (below) is one with the default settings. */
export function createASL(settings: ASLProviderSettings = {}): OpenAICompatibleProvider<ASLChatModelId, string, ASLEmbeddingModelId, string> {
  const baseFetch: FetchFunction = settings.fetch ?? ((input, init) => globalThis.fetch(input, init));
  // The key is read when a request is made, not when the module loads, so an app that loads its
  // environment after importing the provider still works.
  const fetchWithKey: FetchFunction = (input, init) => {
    const key = settings.apiKey ?? env('ASL_ROUTER_KEY') ?? env('ASL_API_KEY');
    if (!key) {
      return Promise.reject(new Error('Missing router key: pass { apiKey } to createASL or set ASL_ROUTER_KEY. Create one at https://aistupidlevel.info/router/keys'));
    }
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${key}`);
    return baseFetch(input, { ...init, headers });
  };
  return createOpenAICompatible<ASLChatModelId, string, ASLEmbeddingModelId, string>({
    name: 'aistupidlevel',
    baseURL: (settings.baseURL ?? env('ASL_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    headers: {
      'X-ASL-Client': `asl-ai-sdk-provider/${VERSION}`,
      ...(settings.sandbox ? { 'X-ASL-Sandbox': 'true' } : {}),
      ...settings.headers,
    },
    fetch: fetchWithKey,
    includeUsage: true,
    supportsStructuredOutputs: true,
    metadataExtractor,
  });
}

/** The default provider: reads ASL_ROUTER_KEY. */
export const asl = createASL();

/**
 * The full routing decision from a result: `routingFromResponse(await generateText(...))`.
 * Reads the X-AISM-* headers the AI SDK keeps in `result.response.headers`.
 */
export function routingFromResponse(result: { response?: { headers?: Record<string, string> }; providerMetadata?: any }): ASLRoutingInfo {
  const raw = result?.response?.headers ?? {};
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) h[k.toLowerCase()] = String(v);
  const meta = result?.providerMetadata?.aistupidlevel ?? {};
  const reasoning = h['x-aism-reasoning'] ?? null;
  return {
    model: h['x-aism-model'] ?? meta.model ?? null,
    provider: h['x-aism-provider'] ?? meta.provider ?? null,
    reasoning,
    requestId: h['x-aism-request-id'] ?? null,
    sandbox: h['x-aism-sandbox'] === 'true',
    fallback: !!reasoning && /fallback activated/i.test(reasoning),
  };
}
