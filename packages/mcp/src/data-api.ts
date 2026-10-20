/**
 * Client for the ASL Data API (https://aistupidlevel.info/api/v1).
 *
 * A free key allows 10 requests a day and 1 a minute, so every response is cached in memory
 * (default 15 minutes, keyed by URL), identical requests in flight are shared, refusals that will
 * not change (403, 404) are cached too, and once the daily quota is spent no further request is
 * sent until it resets. When a request cannot be made, an older cached answer is served with a
 * note saying how old it is.
 */
import { LINKS, VERSION, type ResolvedConfig } from './config.js';
import { ToolError } from './errors.js';

/** The envelope every Data API response is wrapped in. */
export interface Envelope<T = unknown> {
  success: boolean;
  version?: string;
  generated_at?: string;
  license?: string;
  period?: string;
  sort_by?: string;
  count?: number;
  limit?: number;
  data: T;
  [extra: string]: unknown;
}

export interface DataResult<T = unknown> {
  body: Envelope<T>;
  /** When this answer was fetched from the API. */
  fetchedAt: number;
  cached: boolean;
  /** Set when an expired answer is served because a fresh one could not be fetched. */
  staleReason?: string;
}

export interface Quota {
  limit: number;
  remaining: number;
  /** Epoch ms of the next reset (00:00 UTC). */
  resetAt: number | null;
}

interface Entry { body?: Envelope; error?: string; fetchedAt: number; expires: number }

/** How long an expired answer may still be served when the API cannot be reached. */
const STALE_LIMIT_MS = 24 * 60 * 60 * 1000;

export interface ModelRef { id: number; name: string; displayName: string | null }

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const nextUtcMidnight = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};
const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, '-');

export class DataApi {
  private readonly cache = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<DataResult>>();
  private readonly models = new Map<string, ModelRef>();
  private modelsSeenAt = 0;
  /** The newest leaderboard (/models) answer, for showing a model's row without a request. */
  lastBoard: Envelope | null = null;
  private dailyBlockedUntil = 0;
  private dailyBlockedMessage = '';
  private lastQuota: Quota | null = null;
  /** Network requests actually sent (for tests and diagnostics). */
  requestsSent = 0;

  constructor(private readonly cfg: ResolvedConfig) {}

  get hasKey(): boolean { return !!this.cfg.dataKey; }
  /** The quota from the newest response, or null once its day is over. */
  get quota(): Quota | null {
    return this.lastQuota && (this.lastQuota.resetAt ?? Infinity) > Date.now() ? this.lastQuota : null;
  }

  /** The error a data tool returns when no Data API key is configured. */
  missingKeyError(): ToolError {
    const why = this.cfg.warnings.data ? `${this.cfg.warnings.data} ` : '';
    return new ToolError(
      `${why}This tool reads the AI Stupid Level Data API and needs a Data API key (asl_live_…). ` +
      `Create one at ${LINKS.dataKeys} (a free key allows 10 requests a day and 1 a minute), then set ` +
      `ASL_DATA_KEY in the "env" section of this MCP server's configuration and restart the client. ` +
      `API documentation: ${LINKS.dataDocs}`,
    );
  }

  /**
   * GET a Data API path. `query` values that are undefined are left out, so "let the API choose"
   * and an explicit value are cached separately, exactly as the API would answer them.
   */
  async get<T = unknown>(path: string, query: Record<string, string | number | undefined> = {}): Promise<DataResult<T>> {
    if (!this.cfg.dataKey) throw this.missingKeyError();
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${this.cfg.dataBaseURL}${path}${qs ? `?${qs}` : ''}`;
    const now = Date.now();
    const hit = this.cache.get(url);
    if (hit && hit.expires > now) {
      if (hit.error) throw new ToolError(hit.error);
      return { body: hit.body as Envelope<T>, fetchedAt: hit.fetchedAt, cached: true };
    }
    if (this.dailyBlockedUntil > now) return this.staleOr<T>(url, this.dailyBlockedMessage);

    let pending = this.inflight.get(url);
    if (!pending) {
      pending = this.fetchUrl(url).finally(() => this.inflight.delete(url));
      this.inflight.set(url, pending);
    }
    return pending as Promise<DataResult<T>>;
  }

  /** Resolve a model given as a numeric id, a model name (claude-opus-5-5) or a display name. */
  async resolveModel(input: string): Promise<ModelRef> {
    const raw = String(input).trim();
    if (/^\d+$/.test(raw)) {
      const id = Number(raw);
      for (const m of this.models.values()) if (m.id === id) return m;
      return { id, name: raw, displayName: null };
    }
    if (!this.models.size || Date.now() - this.modelsSeenAt > STALE_LIMIT_MS) {
      // One request teaches us every id; later lookups are free.
      await this.get('/models');
    }
    const want = norm(raw);
    const exact = this.models.get(want);
    if (exact) return exact;
    const unique = [...new Map([...this.models.values()].map(m => [m.id, m])).values()];
    const partial = unique.filter(m => norm(m.name).includes(want) || (m.displayName && norm(m.displayName).includes(want)));
    if (partial.length === 1) return partial[0];
    const list = (partial.length ? partial : unique).map(m => `${m.name} (id ${m.id})`).join(', ');
    throw new ToolError(partial.length
      ? `"${raw}" matches more than one model: ${list}. Pass the exact name or the numeric id.`
      : `No tracked model matches "${raw}". Tracked models: ${list}.`);
  }

  /** Every model the last /models answer listed (no request is made). */
  knownModel(id: number): ModelRef | undefined {
    for (const m of this.models.values()) if (m.id === id) return m;
    return undefined;
  }

  private learnModels(body: Envelope) {
    if (!Array.isArray(body?.data)) return;
    for (const m of body.data as any[]) {
      const id = Number(m?.id);
      if (!Number.isFinite(id) || typeof m?.name !== 'string') continue;
      const ref: ModelRef = { id, name: m.name, displayName: typeof m.displayName === 'string' ? m.displayName : null };
      this.models.set(norm(m.name), ref);
      if (ref.displayName) this.models.set(norm(ref.displayName), ref);
    }
    this.modelsSeenAt = Date.now();
    this.lastBoard = body;
  }

  private staleOr<T>(url: string, message: string): DataResult<T> {
    const old = this.cache.get(url);
    if (old?.body && Date.now() - old.fetchedAt < STALE_LIMIT_MS) {
      return { body: old.body as Envelope<T>, fetchedAt: old.fetchedAt, cached: true, staleReason: message };
    }
    throw new ToolError(message);
  }

  private readQuota(h: Headers) {
    const limit = Number(h.get('x-ratelimit-limit'));
    const remaining = Number(h.get('x-ratelimit-remaining'));
    const reset = Number(h.get('x-ratelimit-reset'));
    // The daily quota's reset is an epoch timestamp. The per-minute limiter sends the same header
    // names with its own values (limit 1, reset in seconds), which say nothing about the day.
    if (h.get('x-ratelimit-limit') !== null && Number.isFinite(limit) && Number.isFinite(remaining) && reset > 1e9) {
      this.lastQuota = { limit, remaining, resetAt: reset * 1000 };
    }
  }

  private async fetchUrl(url: string, attempt = 0): Promise<DataResult> {
    let res: Response;
    try {
      this.requestsSent++;
      res = await this.cfg.fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.cfg.dataKey}`, Accept: 'application/json', 'User-Agent': `aistupidlevel-mcp/${VERSION}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      return this.staleOr(url, `Could not reach the AI Stupid Level Data API (${(err as Error)?.message ?? err}). Try again shortly.`);
    }
    this.readQuota(res.headers);
    let body: any = null;
    const text = await res.text().catch(() => '');
    try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    const now = Date.now();

    if (res.ok && body && typeof body === 'object') {
      const entry: Entry = { body, fetchedAt: now, expires: now + this.cfg.cacheTtlMs };
      this.cache.set(url, entry);
      if (/\/models(\?|$)/.test(url)) this.learnModels(body);
      return { body, fetchedAt: now, cached: false };
    }

    const apiMessage = typeof body?.message === 'string' ? body.message : '';
    const code = typeof body?.error === 'string' ? body.error : '';

    if (res.status === 401) {
      throw new ToolError(
        `The Data API rejected the key in ASL_DATA_KEY (${code || 'HTTP 401'}${apiMessage ? `: ${apiMessage}` : ''}). ` +
        `Check it, or create a new one at ${LINKS.dataKeys}.`,
      );
    }
    if (res.status === 429) {
      const quota = this.lastQuota;
      if (code === 'quota_exceeded') {
        this.dailyBlockedUntil = quota?.resetAt && quota.resetAt > now ? quota.resetAt : nextUtcMidnight();
        const mins = Math.max(1, Math.round((this.dailyBlockedUntil - now) / 60_000));
        this.dailyBlockedMessage =
          `The Data API daily limit for this key is used up. ${apiMessage || 'The quota resets at 00:00 UTC.'} ` +
          `That is in about ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}; until then this server sends no more requests. ` +
          `A free key allows 10 requests a day and 1 a minute; paid plans raise this to 10,000 a day or more: ${LINKS.pricing}`;
        return this.staleOr(url, this.dailyBlockedMessage);
      }
      const ra = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000;
      if (attempt === 0 && wait <= this.cfg.maxWaitMs) {
        await sleep(wait);
        return this.fetchUrl(url, 1);
      }
      return this.staleOr(url,
        `The Data API per-minute limit was reached; try again in ${Math.ceil(wait / 1000)} s. ` +
        `A free key allows 1 request a minute and 10 a day (answers are cached here for ${Math.round(this.cfg.cacheTtlMs / 60_000)} min, ` +
        `so repeating a question costs nothing). Higher limits: ${LINKS.pricing}`);
    }
    if (res.status === 403 || res.status === 404 || res.status === 400) {
      let msg: string;
      if (code === 'latest_requires_plan') {
        msg = `${apiMessage || 'The latest benchmark run is part of the paid plans.'} Plans: ${typeof body?.pricing === 'string' ? body.pricing : LINKS.pricing}`;
      } else if (code === 'model_not_found' || res.status === 404) {
        msg = `AI Stupid Level does not track a model with that id${body?.model ? ` (${body.model})` : ''}. Use get_leaderboard to see the tracked models and their ids.`;
      } else {
        msg = `The Data API refused the request (HTTP ${res.status}${code ? ` ${code}` : ''}${apiMessage ? `: ${apiMessage}` : ''}).`;
      }
      // The answer will not change within the cache period; asking again would only spend quota.
      this.cache.set(url, { error: msg, fetchedAt: now, expires: now + this.cfg.cacheTtlMs });
      throw new ToolError(msg);
    }
    return this.staleOr(url, `The AI Stupid Level Data API answered HTTP ${res.status}${apiMessage ? ` (${apiMessage})` : ''}. Try again shortly.`);
  }
}

