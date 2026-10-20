/** Settings, read from the environment by default. Keys are never logged or echoed back. */

export const VERSION = '0.1.1';
export const DEFAULT_DATA_BASE_URL = 'https://aistupidlevel.info/api/v1';
export const DEFAULT_ROUTER_BASE_URL = 'https://aistupidlevel.info/v1';

export const LINKS = {
  dataKeys: 'https://aistupidlevel.info/account/data-keys',
  dataDocs: 'https://aistupidlevel.info/api-docs',
  routerKeys: 'https://aistupidlevel.info/router/keys',
  routerDocs: 'https://aistupidlevel.info/router/docs',
  providerKeys: 'https://aistupidlevel.info/router/providers',
  pricing: 'https://aistupidlevel.info/pricing',
  billing: 'https://aistupidlevel.info/account/billing',
  site: 'https://aistupidlevel.info',
} as const;

export interface ServerOptions {
  /** Data API key (asl_live_…). Default: ASL_DATA_KEY, or ASL_API_KEY when it is an asl_ key. */
  dataKey?: string;
  /** Smart Router key (aism_…). Default: ASL_ROUTER_KEY, or ASL_API_KEY when it is an aism_ key. */
  routerKey?: string;
  /** Default: ASL_DATA_BASE_URL or https://aistupidlevel.info/api/v1 */
  dataBaseURL?: string;
  /** Default: ASL_BASE_URL or https://aistupidlevel.info/v1 */
  routerBaseURL?: string;
  /** How long a Data API response is reused, in seconds. Default: ASL_CACHE_TTL or 900 (15 minutes). */
  cacheTtlSeconds?: number;
  /**
   * When the Data API's per-minute limit answers 429 with a Retry-After of at most this many
   * seconds, wait and retry once. Default: ASL_MAX_WAIT or 15. 0 never waits.
   */
  maxWaitSeconds?: number;
  /** Force sandbox mode for every Smart Router call (mock answers, nothing spent). Default: ASL_SANDBOX. */
  forceSandbox?: boolean;
  /** Per-request timeout for Smart Router calls, ms. Default: ASL_TIMEOUT_MS or 300000. */
  routerTimeoutMs?: number;
  /** A fetch implementation (tests, proxies). Default: the global fetch. */
  fetch?: typeof fetch;
  /** Read settings from this object instead of process.env. */
  env?: Record<string, string | undefined>;
  /** Where diagnostics go. Default: stderr (stdout belongs to the stdio transport). */
  log?: (message: string) => void;
}

export interface ResolvedConfig {
  dataKey: string | null;
  routerKey: string | null;
  dataBaseURL: string;
  routerBaseURL: string;
  cacheTtlMs: number;
  maxWaitMs: number;
  forceSandbox: boolean;
  routerTimeoutMs: number;
  fetch: typeof fetch;
  log: (message: string) => void;
  /** Problems with the configuration, reported by the tools that are affected. */
  warnings: { data?: string; router?: string };
}

const truthy = (v: string | undefined) => !!v && /^(1|true|yes|on)$/i.test(v.trim());
const num = (v: string | undefined, fallback: number) => {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export function resolveConfig(o: ServerOptions = {}): ResolvedConfig {
  const env = o.env ?? (globalThis as any).process?.env ?? {};
  const generic = clean(env.ASL_API_KEY);
  let dataKey = clean(o.dataKey) ?? clean(env.ASL_DATA_KEY) ?? (generic?.startsWith('asl_') ? generic : null);
  let routerKey = clean(o.routerKey) ?? clean(env.ASL_ROUTER_KEY) ?? (generic?.startsWith('aism_') ? generic : null);
  const warnings: ResolvedConfig['warnings'] = {};

  // The two products use different keys; a swapped pair is the most likely set-up mistake.
  if (dataKey?.startsWith('aism_')) {
    warnings.data = 'ASL_DATA_KEY holds a Smart Router key (aism_…). The Data API needs a Data API key (asl_live_…).';
    if (!routerKey) routerKey = dataKey;
    dataKey = null;
  }
  if (routerKey?.startsWith('asl_')) {
    warnings.router = 'ASL_ROUTER_KEY holds a Data API key (asl_…). The Smart Router needs a router key (aism_…).';
    if (!dataKey) dataKey = routerKey;
    routerKey = null;
  }

  const f = o.fetch ?? (globalThis as any).fetch;
  if (typeof f !== 'function') throw new Error('No fetch implementation is available: use Node 18 or later.');

  return {
    dataKey,
    routerKey,
    dataBaseURL: (o.dataBaseURL ?? clean(env.ASL_DATA_BASE_URL) ?? DEFAULT_DATA_BASE_URL).replace(/\/+$/, ''),
    routerBaseURL: (o.routerBaseURL ?? clean(env.ASL_BASE_URL) ?? DEFAULT_ROUTER_BASE_URL).replace(/\/+$/, ''),
    cacheTtlMs: (o.cacheTtlSeconds ?? num(env.ASL_CACHE_TTL, 900)) * 1000,
    maxWaitMs: (o.maxWaitSeconds ?? num(env.ASL_MAX_WAIT, 15)) * 1000,
    forceSandbox: o.forceSandbox ?? truthy(env.ASL_SANDBOX),
    routerTimeoutMs: o.routerTimeoutMs ?? num(env.ASL_TIMEOUT_MS, 300_000),
    fetch: o.fetch ? f : f.bind(globalThis),
    log: o.log ?? ((m: string) => { try { (globalThis as any).process?.stderr?.write(`[aistupidlevel-mcp] ${m}\n`); } catch { /* ignore */ } }),
    warnings,
  };
}
