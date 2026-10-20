import {
  ASLError, AbortError, ConnectionError, StreamInterruptedError, TimeoutError, errorFor,
} from './errors.js';
import type { RoutingInfo } from './types.js';

export const VERSION = '0.1.1';
export const DEFAULT_BASE_URL = 'https://aistupidlevel.info/v1';
/** Reasoning models can think for minutes; the router itself allows 15. */
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_RETRIES = 2;

const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 8_000;
const MAX_RETRY_AFTER_MS = 60_000;

export interface HttpConfig {
  apiKey: string;
  baseURL: string;
  timeout: number;
  maxRetries: number;
  sandbox: boolean;
  defaultHeaders: Record<string, string>;
  fetch: typeof fetch;
}

export interface CallOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
  sandbox?: boolean;
  simulate?: string;
  idempotencyKey?: string;
  /** Streaming: return the open Response instead of parsing JSON. */
  stream?: boolean;
  /** Send no Authorization header (public endpoints). */
  noAuth?: boolean;
}

export interface RawResult {
  response: Response;
  headers: Record<string, string>;
  data?: unknown;
}

export function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => { out[k.toLowerCase()] = v; });
  return out;
}

export function routingFromHeaders(headers: Record<string, string> | Headers): RoutingInfo {
  const h = typeof (headers as Headers).forEach === 'function' && !(headers as any)['x-aism-model']
    ? headersToObject(headers as Headers) : headers as Record<string, string>;
  const get = (k: string) => h[k] ?? h[k.toLowerCase()] ?? null;
  const reasoning = get('x-aism-reasoning');
  const latency = get('x-aism-latency');
  return {
    provider: get('x-aism-provider'),
    model: get('x-aism-model'),
    reasoning,
    latencyMs: latency !== null && latency !== '' && !Number.isNaN(Number(latency)) ? Number(latency) : null,
    requestId: get('x-aism-request-id'),
    sandbox: get('x-aism-sandbox') === 'true',
    replayed: get('idempotent-replayed') === 'true',
    fallback: !!reasoning && /fallback activated/i.test(reasoning),
  };
}

/** Retry-After / Retry-After-Ms in ms, capped; null when absent or unusable. */
export function retryAfterMs(headers: Record<string, string>): number | null {
  const ms = headers['retry-after-ms'];
  if (ms && !Number.isNaN(Number(ms))) return Math.min(Number(ms), MAX_RETRY_AFTER_MS);
  const ra = headers['retry-after'];
  if (!ra) return null;
  if (!Number.isNaN(Number(ra))) return Math.min(Number(ra) * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(ra);
  return Number.isNaN(date) ? null : Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
}

/** Exponential backoff with jitter: 0.5 s, 1 s, 2 s … capped at 8 s, each reduced by up to 25%. */
export function backoffMs(attempt: number): number {
  const base = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
  return Math.round(base * (1 - Math.random() * 0.25));
}

/** Whether a failed attempt should be retried: the server's x-should-retry wins, then the status. */
export function shouldRetry(status: number, headers: Record<string, string>): boolean {
  const hint = headers['x-should-retry'];
  if (hint === 'true') return true;
  if (hint === 'false') return false;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export function newIdempotencyKey(): string {
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return `asl-${c.randomUUID()}`;
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return `asl-${Date.now().toString(16)}-${s}`;
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new AbortError('Request aborted', { cause: signal.reason }));
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(new AbortError('Request aborted', { cause: signal!.reason })); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

/**
 * One API call with timeouts, cancellation and retries. Retries: connection failures, timeouts,
 * 408, 409, 429 and 5xx, unless the router says x-should-retry: false; Retry-After is honoured.
 * A streaming call is only retried before the response arrives — never once it has started.
 */
export async function call(cfg: HttpConfig, opts: CallOptions): Promise<RawResult> {
  const maxRetries = opts.maxRetries ?? cfg.maxRetries;
  const timeout = opts.timeout ?? cfg.timeout;
  const url = cfg.baseURL.replace(/\/+$/, '') + opts.path;
  const headers: Record<string, string> = {
    Accept: opts.stream ? 'text/event-stream' : 'application/json',
    'X-ASL-Client': `asl-router-js/${VERSION}`,
    ...cfg.defaultHeaders,
  };
  if (!opts.noAuth) headers.Authorization = `Bearer ${cfg.apiKey}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.sandbox ?? cfg.sandbox) headers['X-ASL-Sandbox'] = 'true';
  if (opts.simulate) headers['X-ASL-Sandbox-Simulate'] = opts.simulate;
  // The same key on every attempt: a retry of a request whose answer was lost is never charged twice.
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  Object.assign(headers, opts.headers);
  const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    const onCallerAbort = () => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted) { clearTimeout(timer); throw new AbortError('Request aborted', { cause: opts.signal.reason }); }
      opts.signal.addEventListener('abort', onCallerAbort, { once: true });
    }
    const cleanup = () => { clearTimeout(timer); opts.signal?.removeEventListener('abort', onCallerAbort); };

    let response: Response;
    try {
      response = await cfg.fetch(url, { method: opts.method, headers, body: payload, signal: controller.signal });
    } catch (cause) {
      cleanup();
      if (opts.signal?.aborted) throw new AbortError('Request aborted', { cause });
      const err = timedOut
        ? new TimeoutError(`No response within ${timeout} ms`, { cause })
        : new ConnectionError(`Connection failed: ${(cause as Error)?.message ?? cause}`, { cause });
      if (attempt < maxRetries) { await sleep(backoffMs(attempt), opts.signal); continue; }
      throw err;
    }

    const respHeaders = headersToObject(response.headers);
    if (response.ok) {
      if (opts.stream) {
        // The timeout covered the time to the first byte; the stream itself may run long. The
        // caller's signal stays attached, so aborting it later still closes the stream.
        clearTimeout(timer);
        return { response, headers: respHeaders };
      }
      let text: string;
      try {
        text = await response.text();
      } catch (cause) {
        cleanup();
        if (opts.signal?.aborted) throw new AbortError('Request aborted', { cause });
        const err = timedOut ? new TimeoutError(`No response within ${timeout} ms`, { cause }) : new ConnectionError('The connection closed while reading the response', { cause });
        if (attempt < maxRetries) { await sleep(backoffMs(attempt), opts.signal); continue; }
        throw err;
      }
      cleanup();
      let data: unknown;
      try { data = text ? JSON.parse(text) : null; } catch (cause) {
        throw new ASLError('The router returned a response that is not JSON', { status: response.status, body: text.slice(0, 500), headers: respHeaders, cause });
      }
      return { response, headers: respHeaders, data };
    }

    let body: unknown = null;
    try { const t = await response.text(); body = t ? JSON.parse(t) : null; } catch { /* keep null */ }
    cleanup();
    const wait = retryAfterMs(respHeaders);
    const err = errorFor(response.status, body, respHeaders, wait);
    if (attempt < maxRetries && shouldRetry(response.status, respHeaders)) {
      await sleep(wait ?? backoffMs(attempt), opts.signal);
      continue;
    }
    throw err;
  }
}

/**
 * Server-sent events from the router: yields each `data:` JSON object until `[DONE]`. A chunk
 * carrying `error` (the stream stopped mid-answer) is thrown as StreamInterruptedError.
 */
export async function* readEvents(response: Response, signal?: AbortSignal): AsyncGenerator<any> {
  if (!response.body) throw new ConnectionError('The stream has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const requestId = response.headers.get('x-aism-request-id');
  try {
    for (;;) {
      if (signal?.aborted) throw new AbortError('Stream aborted');
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (cause) {
        if (signal?.aborted) throw new AbortError('Stream aborted', { cause });
        throw new StreamInterruptedError('The connection closed during the stream', { cause, requestId });
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let sep: number;
      while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(buffer[sep] === '\r' ? sep + 4 : sep + 2);
        const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue;
        if (data === '[DONE]') return;
        let obj: any;
        try { obj = JSON.parse(data); } catch { continue; }
        if (obj && obj.error) {
          throw new StreamInterruptedError(obj.error.message || 'The stream stopped before the answer finished', {
            code: obj.error.code ?? 'stream_interrupted', type: obj.error.type ?? null, requestId, body: obj,
          });
        }
        yield obj;
      }
    }
    // Ended without [DONE]: the connection dropped mid-answer.
    throw new StreamInterruptedError('The stream ended before it was complete', { requestId });
  } finally {
    // Also when the caller stops reading early: close the connection now, not at garbage collection.
    reader.cancel().catch(() => { /* already closed */ });
  }
}
