import { PRICING_URL, PROVIDER_KEYS_URL, ROUTER_API_URL, ROUTER_KEYS_URL } from "./constants";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Who answered and why, from the X-AISM-* response headers. */
export interface Routing {
  model: string | null;
  provider: string | null;
  reasoning: string | null;
  latencyMs: number | null;
  requestId: string | null;
  sandbox: boolean;
  fallback: boolean;
}

export interface RouteSelection {
  model: string;
  provider: string;
  score: number | null;
  reasoning: string;
  estimated_cost_usd: number | null;
}

export interface RoutePreview {
  object: "route.preview";
  requested_model: string;
  strategy: string;
  sandbox: boolean;
  primary: RouteSelection;
  fallbacks: RouteSelection[];
  fallback_enabled: boolean;
}

export interface StreamDelta {
  content?: string;
  reasoning?: string;
}

type HeaderBag = { get(name: string): string | null };

export function routingFromHeaders(headers: HeaderBag): Routing {
  const reasoning = headers.get("x-aism-reasoning");
  const latency = headers.get("x-aism-latency");
  const latencyMs =
    latency !== null && latency.trim() !== "" && Number.isFinite(Number(latency)) ? Number(latency) : null;
  return {
    model: headers.get("x-aism-model"),
    provider: headers.get("x-aism-provider"),
    reasoning,
    latencyMs,
    requestId: headers.get("x-aism-request-id"),
    sandbox: headers.get("x-aism-sandbox") === "true",
    fallback: !!reasoning && /fallback activated/i.test(reasoning),
  };
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class RouterError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly helpUrl: string | null;
  readonly helpTitle: string | null;
  readonly requestId: string | null;

  constructor(
    message: string,
    opts: {
      status?: number | null;
      code?: string | null;
      helpUrl?: string | null;
      helpTitle?: string | null;
      requestId?: string | null;
    } = {},
  ) {
    super(message);
    this.name = "RouterError";
    this.status = opts.status ?? null;
    this.code = opts.code ?? null;
    this.helpUrl = opts.helpUrl ?? null;
    this.helpTitle = opts.helpTitle ?? null;
    this.requestId = opts.requestId ?? null;
  }
}

/** Router errors are OpenAI-shaped: `{ error: { message, code, type } }`. */
export function routerErrorFor(status: number, body: unknown, headers: HeaderBag): RouterError {
  const err =
    body &&
    typeof body === "object" &&
    (body as { error?: unknown }).error &&
    typeof (body as { error: unknown }).error === "object"
      ? ((body as { error: Record<string, unknown> }).error as Record<string, unknown>)
      : {};
  const code = typeof err.code === "string" ? err.code : null;
  const serverMessage = typeof err.message === "string" && err.message ? err.message : null;
  const requestId = headers.get("x-aism-request-id");
  const base = { status, code, requestId };

  if (status === 401) {
    return new RouterError("The Smart Router key was not accepted. Check it in the extension preferences.", {
      ...base,
      helpUrl: ROUTER_KEYS_URL,
      helpTitle: "Manage Router Keys",
    });
  }
  switch (code) {
    case "no_provider_keys":
    case "provider_key_rejected":
      return new RouterError(serverMessage ?? "Add a provider key (OpenAI, Anthropic, Google …) to your account.", {
        ...base,
        helpUrl: PROVIDER_KEYS_URL,
        helpTitle: "Manage Provider Keys",
      });
    case "provider_quota_exceeded":
      return new RouterError(serverMessage ?? "Your provider account is out of credit or quota.", {
        ...base,
        helpUrl: PROVIDER_KEYS_URL,
        helpTitle: "Manage Provider Keys",
      });
    case "allowance_exhausted":
      return new RouterError(serverMessage ?? "This month's Smart Router allowance is used up.", {
        ...base,
        helpUrl: PRICING_URL,
        helpTitle: "View Plans",
      });
    case "insufficient_quota":
      return new RouterError(serverMessage ?? "This key's monthly budget is reached.", {
        ...base,
        helpUrl: ROUTER_KEYS_URL,
        helpTitle: "Manage Router Keys",
      });
  }
  if (status === 429) {
    const wait = headers.get("retry-after");
    return new RouterError(
      serverMessage ?? `Too many requests.${wait ? ` Try again in ${wait} s.` : " Try again shortly."}`,
      base,
    );
  }
  if (status >= 500) {
    return new RouterError(
      serverMessage ?? `The Smart Router did not answer (HTTP ${status}). Try again shortly.`,
      base,
    );
  }
  return new RouterError(serverMessage ?? `The request was refused (HTTP ${status}).`, base);
}

// ── Transport ───────────────────────────────────────────────────────────────

export interface RouterRequestOptions {
  apiKey: string | undefined;
  /** Real routing, mock answer: nothing is sent to a provider and nothing is charged. */
  sandbox?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function requireKey(apiKey: string | undefined): string {
  const key = apiKey?.trim();
  if (!key) {
    throw new RouterError("Add your Smart Router key in the extension preferences.", {
      code: "missing_key",
      helpUrl: ROUTER_KEYS_URL,
      helpTitle: "Create a Router Key",
    });
  }
  return key;
}

function headersFor(key: string, sandbox: boolean | undefined, accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: accept,
    "X-ASL-Client": "raycast-extension",
  };
  if (sandbox) headers["X-ASL-Sandbox"] = "true";
  return headers;
}

async function post(path: string, body: unknown, opts: RouterRequestOptions, accept: string): Promise<Response> {
  const key = requireKey(opts.apiKey);
  const doFetch = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${ROUTER_API_URL}${path}`, {
      method: "POST",
      headers: headersFor(key, opts.sandbox, accept),
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (cause) {
    if (opts.signal?.aborted) throw cause;
    throw new RouterError("Could not reach aistupidlevel.info. Check your connection.", { code: "network" });
  }
  if (!response.ok) {
    let parsed: unknown = null;
    try {
      const text = await response.text();
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    throw routerErrorFor(response.status, parsed, response.headers);
  }
  return response;
}

/** The routing decision a request would get, without sending it. Nothing is called or counted. */
export async function previewRoute(
  params: { model: string; messages: ChatMessage[] },
  opts: RouterRequestOptions,
): Promise<RoutePreview> {
  const response = await post("/route/preview", params, opts, "application/json");
  return (await response.json()) as RoutePreview;
}

// ── Server-sent events ──────────────────────────────────────────────────────

/** Split a text stream into SSE `data:` payloads. Ends at `[DONE]`. */
export async function* sseData(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk;
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(buffer)) !== null) {
      const event = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      if (data === "[DONE]") return;
      yield data;
    }
  }
  throw new RouterError("The answer stopped before it was complete.", { code: "stream_interrupted" });
}

/** One OpenAI-format streaming chunk, as far as this extension reads it. */
export interface ChatChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}

/** Parse SSE payloads into chunks. A chunk carrying `error` (the stream broke mid-answer) is thrown. */
export async function* parseChunks(
  payloads: AsyncIterable<string>,
  requestId: string | null,
): AsyncGenerator<ChatChunk> {
  for await (const data of payloads) {
    let chunk: ChatChunk & { error?: { message?: string; code?: string } };
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    if (chunk && chunk.error) {
      throw new RouterError(chunk.error.message || "The answer stopped before it was complete.", {
        code: chunk.error.code ?? "stream_interrupted",
        requestId,
      });
    }
    if (chunk && typeof chunk === "object") yield chunk;
  }
}

/** Text and reasoning deltas from chunks. */
export async function* chatDeltas(chunks: AsyncIterable<ChatChunk>): AsyncGenerator<StreamDelta> {
  for await (const chunk of chunks) {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    const out: StreamDelta = {};
    if (typeof delta.content === "string" && delta.content) out.content = delta.content;
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) out.reasoning = delta.reasoning_content;
    if (out.content || out.reasoning) yield out;
  }
}

async function* decodeBody(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/** Open a streamed chat completion. The routing decision is known before the first chunk. */
export async function openChatStream(
  body: Record<string, unknown>,
  opts: RouterRequestOptions,
): Promise<{ routing: Routing; chunks: AsyncGenerator<ChatChunk> }> {
  const response = await post("/chat/completions", { ...body, stream: true }, opts, "text/event-stream");
  if (!response.body) throw new RouterError("The Smart Router sent an empty answer.", { code: "empty_stream" });
  const routing = routingFromHeaders(response.headers);
  return { routing, chunks: parseChunks(sseData(decodeBody(response.body)), routing.requestId) };
}

export interface ChatStream {
  routing: Routing;
  deltas: AsyncGenerator<StreamDelta>;
}

/** Stream a plain chat answer (text and any reasoning the model shows). */
export async function streamChat(
  params: { model: string; messages: ChatMessage[]; temperature?: number },
  opts: RouterRequestOptions,
): Promise<ChatStream> {
  const { routing, chunks } = await openChatStream(params, opts);
  return { routing, deltas: chatDeltas(chunks) };
}
