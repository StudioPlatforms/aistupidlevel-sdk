/**
 * The few Smart Router calls the MCP tools make (https://aistupidlevel.info/v1): route preview,
 * chat completion and usage. Same conventions as @aistupidlevel/router: Bearer aism_ key,
 * X-ASL-Sandbox for mock answers, routing read from the X-AISM-* response headers, and an
 * Idempotency-Key on chat so a retried request is never charged twice.
 */
import { LINKS, VERSION, type ResolvedConfig } from './config.js';
import { ToolError } from './errors.js';

export interface Routing {
  provider: string | null;
  model: string | null;
  reasoning: string | null;
  latencyMs: number | null;
  requestId: string | null;
  sandbox: boolean;
  fallback: boolean;
}

export interface RouterResult<T = any> { data: T; routing: Routing }

export const ROUTING_MODES = [
  'auto', 'auto-best', 'auto-coding', 'auto-reasoning', 'auto-tooling', 'auto-task',
  'auto-value', 'auto-value-coding', 'auto-value-reasoning', 'auto-value-tooling',
  'auto-fastest-quality', 'auto-consistent', 'auto-fastest', 'auto-cheapest',
] as const;

function routingFrom(h: Headers): Routing {
  const reasoning = h.get('x-aism-reasoning');
  const latency = h.get('x-aism-latency');
  return {
    provider: h.get('x-aism-provider'),
    model: h.get('x-aism-model'),
    reasoning,
    latencyMs: latency !== null && latency !== '' && Number.isFinite(Number(latency)) ? Number(latency) : null,
    requestId: h.get('x-aism-request-id'),
    sandbox: h.get('x-aism-sandbox') === 'true',
    fallback: !!reasoning && /fallback activated/i.test(reasoning),
  };
}

const newIdempotencyKey = () => {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return `asl-mcp-${c.randomUUID()}`;
  return `asl-mcp-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
};

/** A router error in words that say who has to act and where. */
function explain(status: number, body: any): string {
  const err = body && typeof body === 'object' && body.error && typeof body.error === 'object' ? body.error : {};
  const code: string = typeof err.code === 'string' ? err.code : '';
  const msg: string = typeof err.message === 'string' && err.message ? err.message : `HTTP ${status}`;
  switch (code) {
    case 'allowance_exhausted':
      return `The Smart Router plan's monthly allowance is used up and there are no prepaid credits (${msg}). Upgrade or buy credits: ${LINKS.billing}`;
    case 'insufficient_quota':
      return `This router key has reached its hard monthly budget (${msg}). Raise it at ${LINKS.routerKeys}`;
    case 'no_provider_keys':
      return `The Smart Router has no provider key to call a model with (${msg}). Add an OpenAI, Anthropic, Google, DeepSeek, Kimi or GLM key at ${LINKS.providerKeys}, or set sandbox: true to test the routing without one.`;
    case 'provider_key_rejected':
      return `A provider refused the provider key saved in your account (${msg}). Fix it at ${LINKS.providerKeys}`;
    case 'provider_quota_exceeded':
      return `Your provider account is out of credit or quota (${msg}).`;
    case 'no_routable_model':
      return `Your routing preferences exclude every model for this request (${msg}). Review them at ${LINKS.routerDocs}`;
    case 'model_unavailable':
      return `Every model in the fallback chain failed on the provider side (${msg}). Try again shortly.`;
    case 'rate_limited':
      return `The Smart Router is rate limiting this key (${msg}). Try again shortly.`;
  }
  if (status === 401) return `The Smart Router rejected the key in ASL_ROUTER_KEY (${msg}). Check it, or create one at ${LINKS.routerKeys}`;
  if (status === 403) return `This router key may not do that (${msg}).`;
  if (status === 404 && /model/i.test(msg)) return `${msg} Use one of the routing modes (auto, auto-coding, …) or a model id from the leaderboard.`;
  return `The Smart Router answered HTTP ${status}${code ? ` ${code}` : ''}: ${msg}`;
}

export class RouterApi {
  requestsSent = 0;
  constructor(private readonly cfg: ResolvedConfig) {}

  get hasKey(): boolean { return !!this.cfg.routerKey; }

  missingKeyError(): ToolError {
    const why = this.cfg.warnings.router ? `${this.cfg.warnings.router} ` : '';
    return new ToolError(
      `${why}This tool uses the AI Stupid Level Smart Router and needs a router key (aism_…). ` +
      `Create one at ${LINKS.routerKeys} and add at least one provider key (OpenAI, Anthropic, Google, ` +
      `DeepSeek, Kimi or GLM) in your account, then set ASL_ROUTER_KEY in the "env" section of this MCP ` +
      `server's configuration and restart the client. Documentation: ${LINKS.routerDocs}`,
    );
  }

  async request<T = any>(method: 'GET' | 'POST', path: string, body?: unknown, opts: { sandbox?: boolean; idempotent?: boolean } = {}): Promise<RouterResult<T>> {
    if (!this.cfg.routerKey) throw this.missingKeyError();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.routerKey}`,
      Accept: 'application/json',
      'X-ASL-Client': `asl-mcp/${VERSION}`,
      'User-Agent': `aistupidlevel-mcp/${VERSION}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.sandbox || this.cfg.forceSandbox) headers['X-ASL-Sandbox'] = 'true';
    if (opts.idempotent) headers['Idempotency-Key'] = newIdempotencyKey();
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const url = `${this.cfg.routerBaseURL}${path}`;

    // One retry for a dropped connection or a 5xx; the idempotency key makes that safe for chat.
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        this.requestsSent++;
        res = await this.cfg.fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(this.cfg.routerTimeoutMs) });
      } catch (err) {
        if (attempt === 0) { await new Promise(r => setTimeout(r, 500)); continue; }
        const e = err as Error;
        throw new ToolError(e?.name === 'TimeoutError'
          ? `The Smart Router did not answer within ${Math.round(this.cfg.routerTimeoutMs / 1000)} s.`
          : `Could not reach the Smart Router (${e?.message ?? err}).`);
      }
      const text = await res.text().catch(() => '');
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      if (res.ok) {
        if (data === null) throw new ToolError('The Smart Router returned a response that is not JSON.');
        return { data, routing: routingFrom(res.headers) };
      }
      const retryable = res.status >= 500 && res.headers.get('x-should-retry') !== 'false';
      if (attempt === 0 && retryable) { await new Promise(r => setTimeout(r, 1000)); continue; }
      throw new ToolError(explain(res.status, data));
    }
  }
}
