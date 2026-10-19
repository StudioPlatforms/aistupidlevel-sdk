import {
  call, routingFromHeaders, newIdempotencyKey,
  DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_RETRIES, type HttpConfig, type CallOptions, type RawResult,
} from './core.js';
import { ChatStream, withRouting, type WithRouting } from './stream.js';
import { ASLError } from './errors.js';
import type {
  ChatCompletion, ChatCompletionCreateParams, ChatMessage, EmbeddingCreateParams, EmbeddingResponse,
  ModelList, RequestOptions, RoutePreview, RoutingInfo, ToolCall, Usage,
} from './types.js';

export interface ClientOptions {
  /** Router key (aism_…). Defaults to the ASL_ROUTER_KEY environment variable. */
  apiKey?: string;
  /** Defaults to https://aistupidlevel.info/v1 (or ASL_BASE_URL). */
  baseURL?: string;
  /**
   * Sandbox mode: every request runs the real routing as if you had a key for every provider, and
   * returns a deterministic mock answer. No provider is called; nothing is spent or counted.
   */
  sandbox?: boolean;
  /** Per-attempt timeout in ms. Default 10 minutes: reasoning models can think for a long time. */
  timeout?: number;
  /** Automatic retries for connection failures, timeouts, 408, 409, 429 and 5xx. Default 2. */
  maxRetries?: number;
  /** Headers added to every request. */
  defaultHeaders?: Record<string, string>;
  /** A fetch implementation, for runtimes without a global one. */
  fetch?: typeof fetch;
  /** Allow use in a browser. Your router key would be visible to anyone using the page. */
  dangerouslyAllowBrowser?: boolean;
  /**
   * Send an Idempotency-Key with every non-streaming chat request (default true), so a retry of a
   * request whose answer was lost is answered from the first attempt instead of paid for twice.
   */
  autoIdempotency?: boolean;
}

export type { WithRouting } from './stream.js';

/** A tool implementation for runTools: receives the parsed arguments, returns anything JSON-able. */
export type ToolHandler = (args: any, call: ToolCall) => unknown | Promise<unknown>;

export interface RunToolsOptions {
  /** One handler per tool name offered in `params.tools`. */
  handlers: Record<string, ToolHandler>;
  /** Stop after this many model turns without a final answer (default 10). */
  maxRounds?: number;
  /** Called after each model turn, e.g. for logging. */
  onRound?: (round: { index: number; completion: WithRouting<ChatCompletion>; toolCalls: ToolCall[] }) => void;
}

export interface RunToolsResult {
  /** The final completion: the turn with no tool calls. */
  completion: WithRouting<ChatCompletion>;
  /** The whole conversation, including every tool call and result, ready to continue. */
  messages: ChatMessage[];
  /** Model turns taken. */
  rounds: number;
  /** Routing of the final turn (a tool loop stays on the model that started it). */
  routing: RoutingInfo;
}

const env = (name: string): string | undefined => {
  try { return (globalThis as any).process?.env?.[name] || undefined; } catch { return undefined; }
};
const inBrowser = () => typeof (globalThis as any).window !== 'undefined' && typeof (globalThis as any).document !== 'undefined';


class Completions {
  constructor(private readonly client: ASLRouter) {}

  /** Create a routed chat completion. With `stream: true`, returns a ChatStream. */
  create(params: ChatCompletionCreateParams & { stream: true }, options?: RequestOptions): Promise<ChatStream>;
  create(params: ChatCompletionCreateParams & { stream?: false | null }, options?: RequestOptions): Promise<WithRouting<ChatCompletion>>;
  create(params: ChatCompletionCreateParams, options?: RequestOptions): Promise<ChatStream | WithRouting<ChatCompletion>>;
  async create(params: ChatCompletionCreateParams, options: RequestOptions = {}): Promise<ChatStream | WithRouting<ChatCompletion>> {
    if (params.stream) {
      const controller = new AbortController();
      if (options.signal) {
        if (options.signal.aborted) controller.abort(options.signal.reason);
        else options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason), { once: true });
      }
      const { response, headers } = await this.client._request({
        ...callOptions(options), method: 'POST', path: '/chat/completions', body: params, stream: true, signal: controller.signal,
      });
      return new ChatStream(response, routingFromHeaders(headers), controller);
    }
    const idempotencyKey = options.idempotencyKey ?? (this.client.autoIdempotency ? newIdempotencyKey() : undefined);
    const { data, headers } = await this.client._request({
      ...callOptions(options), method: 'POST', path: '/chat/completions', body: params, idempotencyKey,
    });
    return withRouting(data as ChatCompletion, routingFromHeaders(headers));
  }
}

class Chat {
  readonly completions: Completions;
  constructor(client: ASLRouter) { this.completions = new Completions(client); }

  /**
   * Run a tool-calling loop to its final answer: the model calls tools, your handlers run, their
   * results go back, until the model answers without a tool call. The router keeps the whole loop
   * on the model that started it. A forced tool_choice applies to the first turn only.
   */
  async runTools(params: ChatCompletionCreateParams, run: RunToolsOptions, options: RequestOptions = {}): Promise<RunToolsResult> {
    const maxRounds = run.maxRounds ?? 10;
    const messages: ChatMessage[] = [...params.messages];
    let toolChoice = params.tool_choice;
    for (let index = 0; index < maxRounds; index++) {
      const completion = await this.completions.create({ ...params, messages, tool_choice: toolChoice, stream: false }, options);
      const message = completion.choices[0]?.message;
      const toolCalls = message?.tool_calls ?? [];
      run.onRound?.({ index, completion, toolCalls });
      if (!toolCalls.length) {
        if (message) messages.push({ role: 'assistant', content: message.content ?? '' });
        return { completion, messages, rounds: index + 1, routing: completion.routing };
      }
      messages.push({ role: 'assistant', content: message?.content ?? null, tool_calls: toolCalls });
      for (const tc of toolCalls) {
        const handler = run.handlers[tc.function.name];
        let content: string;
        if (!handler) {
          content = JSON.stringify({ error: `No handler for the tool "${tc.function.name}".` });
        } else {
          let args: unknown = tc.function.arguments;
          try { args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { /* hand over the raw string */ }
          try {
            const result = await handler(args, tc);
            content = typeof result === 'string' ? result : JSON.stringify(result ?? null);
          } catch (err) {
            // The model sees the failure and can recover; the loop does not crash.
            content = JSON.stringify({ error: (err as Error)?.message ?? String(err) });
          }
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content });
      }
      // A forced choice would force a tool call on every turn and never let the model answer.
      if (toolChoice && toolChoice !== 'auto' && toolChoice !== 'none') toolChoice = 'auto';
    }
    throw new ASLError(`The tool loop reached ${maxRounds} rounds without a final answer. Raise maxRounds or check the tools' results.`, { code: 'max_rounds' });
  }
}

class Route {
  constructor(private readonly client: ASLRouter) {}

  /**
   * The routing decision a chat request would get — strategy, model, fallback chain and reasons —
   * without sending it. Nothing is called or counted. In sandbox mode it answers as if you had a
   * key for every provider.
   */
  async preview(params: Partial<ChatCompletionCreateParams> & { model?: ChatCompletionCreateParams['model'] }, options: RequestOptions = {}): Promise<RoutePreview> {
    const { data } = await this.client._request({ ...callOptions(options), method: 'POST', path: '/route/preview', body: { model: 'auto', ...params } });
    return data as RoutePreview;
  }
}

class Models {
  constructor(private readonly client: ASLRouter) {}
  /** Routing modes and the models the router can pin. */
  async list(options: RequestOptions = {}): Promise<ModelList> {
    const { data } = await this.client._request({ ...callOptions(options), method: 'GET', path: '/models' });
    return data as ModelList;
  }
}

class Embeddings {
  constructor(private readonly client: ASLRouter) {}
  /** OpenAI embedding models, with your OpenAI key. auto-embedding = text-embedding-3-small. */
  async create(params: EmbeddingCreateParams, options: RequestOptions = {}): Promise<EmbeddingResponse> {
    const { data } = await this.client._request({ ...callOptions(options), method: 'POST', path: '/embeddings', body: params });
    return data as EmbeddingResponse;
  }
}

function callOptions(o: RequestOptions): Partial<CallOptions> {
  return { signal: o.signal, timeout: o.timeout, maxRetries: o.maxRetries, headers: o.headers, sandbox: o.sandbox, simulate: o.simulate };
}

/**
 * Client for the AI Stupid Level Smart Router: one OpenAI-compatible endpoint that routes each
 * request to the model measuring best for it, using your own provider keys.
 *
 * ```ts
 * const router = new ASLRouter(); // reads ASL_ROUTER_KEY
 * const res = await router.chat.completions.create({ model: 'auto-coding', messages: [{ role: 'user', content: 'Fix this bug…' }] });
 * console.log(res.choices[0].message.content, res.routing.model, res.routing.reasoning);
 * ```
 */
export class ASLRouter {
  readonly chat: Chat;
  readonly route: Route;
  readonly models: Models;
  readonly embeddings: Embeddings;
  readonly baseURL: string;
  readonly sandbox: boolean;
  /** @internal */
  readonly autoIdempotency: boolean;
  private readonly cfg: HttpConfig;
  private readonly options: ClientOptions;

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey ?? env('ASL_ROUTER_KEY') ?? env('ASL_API_KEY');
    if (!apiKey) {
      throw new ASLError('Missing router key: pass { apiKey } or set ASL_ROUTER_KEY. Create a key at https://aistupidlevel.info/router/keys');
    }
    if (inBrowser() && !options.dangerouslyAllowBrowser) {
      throw new ASLError('ASLRouter is running in a browser, where your router key would be visible to every visitor. Call the router from your server, or pass dangerouslyAllowBrowser: true if the key is yours alone.');
    }
    const f = options.fetch ?? (globalThis as any).fetch;
    if (typeof f !== 'function') {
      throw new ASLError('No fetch implementation is available. Use Node 18+, Bun, Deno or an edge runtime, or pass { fetch }.');
    }
    this.options = options;
    this.baseURL = options.baseURL ?? env('ASL_BASE_URL') ?? DEFAULT_BASE_URL;
    this.sandbox = options.sandbox ?? false;
    this.autoIdempotency = options.autoIdempotency ?? true;
    this.cfg = {
      apiKey,
      baseURL: this.baseURL,
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      sandbox: this.sandbox,
      defaultHeaders: options.defaultHeaders ?? {},
      fetch: options.fetch ? f : f.bind(globalThis),
    };
    this.chat = new Chat(this);
    this.route = new Route(this);
    this.models = new Models(this);
    this.embeddings = new Embeddings(this);
  }

  /** A copy of this client with some options changed, e.g. `router.withOptions({ sandbox: true })`. */
  withOptions(overrides: ClientOptions): ASLRouter {
    return new ASLRouter({ ...this.options, apiKey: this.cfg.apiKey, ...overrides });
  }

  /** Rate an answer by its completion id (`completion.id`). Ratings nudge future routing. */
  async feedback(id: string, rating: 'up' | 'down' | 1 | -1, options: RequestOptions = {}): Promise<{ success: boolean; note?: string }> {
    const { data } = await this._request({ ...callOptions(options), method: 'POST', path: '/router/feedback', body: { id, rating } });
    return data as { success: boolean; note?: string };
  }

  /** This month's allowance, prepaid credits and this key's budget. */
  async usage(options: RequestOptions = {}): Promise<Usage> {
    const { data } = await this._request({ ...callOptions(options), method: 'GET', path: '/usage' });
    return data as Usage;
  }

  /** @internal */
  _request(opts: CallOptions): Promise<RawResult> {
    return call(this.cfg, opts);
  }
}
