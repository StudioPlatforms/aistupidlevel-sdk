import { DATA_API_URL, DATA_KEYS_URL, PRICING_URL } from "./constants";

// ── Response shapes (from real /api/v1 responses) ───────────────────────────

/** One row of GET /models. */
export interface ModelScore {
  id: string;
  /** Model id as the providers and the Smart Router know it, e.g. "claude-opus-5-5". */
  name: string;
  displayName?: string | null;
  provider: string;
  vendor?: string;
  /** Rounded score for the board and period, or "unavailable". */
  currentScore: number | "unavailable";
  exactScore?: number | null;
  trend: "up" | "down" | "stable" | "unavailable" | string;
  status: "excellent" | "good" | "warning" | "critical" | "unavailable" | string;
  lastUpdated?: string | null;
  periodAvg?: number | null;
  stability?: number | null;
  dataPoints?: number | null;
  standardError?: number | null;
  isNew?: boolean;
  isStale?: boolean;
  staleReason?: string | null;
  rankable?: boolean;
  usesReasoningEffort?: boolean;
  suites?: string[];
  suiteUpdatedAt?: Record<string, string | null> | null;
}

/** One row of GET /models/:id/history. */
export interface HistoryPoint {
  timestamp: string;
  score: number | null;
  axes?: Record<string, number | null> | null;
  suite?: string;
}

/** One row of GET /incidents. */
export interface Incident {
  id: number;
  modelId: number | null;
  modelName: string | null;
  provider: string | null;
  incidentType: string;
  severity: "minor" | "major" | "critical" | string;
  title: string;
  description?: string | null;
  detectedAt: string;
  resolvedAt: string | null;
  metadata?: { affectedModels?: string[]; alertRate?: number; [key: string]: unknown } | null;
}

/** The envelope every /api/v1 answer comes in. */
export interface Envelope<T> {
  success: boolean;
  version?: string;
  generated_at?: string;
  period?: string;
  data: T;
}

export interface RateInfo {
  limit: number | null;
  remaining: number | null;
  /** Unix seconds at which the daily quota resets (00:00 UTC). */
  resetAt: number | null;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export type DataApiErrorKind =
  | "missing_key"
  | "invalid_key"
  | "rate_limited"
  | "quota_exceeded"
  | "plan_required"
  | "not_found"
  | "bad_request"
  | "server"
  | "network";

export class DataApiError extends Error {
  readonly kind: DataApiErrorKind;
  readonly status: number | null;
  /** Seconds to wait before the next request, when the server said. */
  readonly retryAfterSec: number | null;
  /** Where the user can fix it: a key page or the pricing page. */
  readonly helpUrl: string | null;

  constructor(
    kind: DataApiErrorKind,
    message: string,
    opts: { status?: number | null; retryAfterSec?: number | null; helpUrl?: string | null } = {},
  ) {
    super(message);
    this.name = "DataApiError";
    this.kind = kind;
    this.status = opts.status ?? null;
    this.retryAfterSec = opts.retryAfterSec ?? null;
    this.helpUrl = opts.helpUrl ?? null;
  }

  /** Whether showing the last good answer is better than showing nothing. */
  get canUseStale(): boolean {
    return (
      this.kind === "rate_limited" ||
      this.kind === "quota_exceeded" ||
      this.kind === "server" ||
      this.kind === "network"
    );
  }
}

type HeaderBag = { get(name: string): string | null };

function toInt(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function readRateInfo(headers: HeaderBag): RateInfo {
  return {
    limit: toInt(headers.get("x-ratelimit-limit")),
    remaining: toInt(headers.get("x-ratelimit-remaining")),
    resetAt: toInt(headers.get("x-ratelimit-reset")),
  };
}

/** Turn an error response into a DataApiError with a message a person can act on. */
export function dataApiErrorFor(status: number, body: unknown, headers: HeaderBag): DataApiError {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const code = typeof b.error === "string" ? b.error : null;
  const serverMessage = typeof b.message === "string" ? b.message : null;
  const retryAfterSec = toInt(headers.get("retry-after"));

  if (status === 401) {
    return new DataApiError(
      "invalid_key",
      code === "api_key_required"
        ? "Add your Data API key in the extension preferences."
        : "The Data API key was not accepted. It may have been revoked; create a new one.",
      { status, helpUrl: DATA_KEYS_URL },
    );
  }
  if (status === 403 && code === "latest_requires_plan") {
    return new DataApiError("plan_required", "The latest run is part of the paid plans. Pick 24h, 7d or 30d.", {
      status,
      helpUrl: PRICING_URL,
    });
  }
  if (status === 429) {
    if (code === "quota_exceeded") {
      return new DataApiError(
        "quota_exceeded",
        serverMessage ?? "The daily Data API quota is used up. It resets at 00:00 UTC.",
        { status, helpUrl: PRICING_URL },
      );
    }
    const wait = retryAfterSec ?? 60;
    return new DataApiError("rate_limited", `Too many requests. Try again in ${wait} s.`, {
      status,
      retryAfterSec: wait,
      helpUrl: PRICING_URL,
    });
  }
  if (status === 404) return new DataApiError("not_found", "Not found.", { status });
  if (status >= 400 && status < 500) {
    return new DataApiError("bad_request", serverMessage ?? `The request was refused (HTTP ${status}).`, { status });
  }
  return new DataApiError("server", `AI Stupid Level did not answer (HTTP ${status}). Try again later.`, { status });
}

export interface DataApiResult<T> {
  data: T;
  rate: RateInfo;
  generatedAt: string | null;
}

/** GET one /api/v1 path. `fetchImpl` is injectable for tests. */
export async function dataApiGet<T>(
  path: string,
  apiKey: string | undefined,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<DataApiResult<T>> {
  const key = apiKey?.trim();
  if (!key) {
    throw new DataApiError("missing_key", "Add a Data API key in the extension preferences to load scores.", {
      helpUrl: DATA_KEYS_URL,
    });
  }
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${DATA_API_URL}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: options.signal,
    });
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    throw new DataApiError("network", "Could not reach aistupidlevel.info. Check your connection.");
  }

  let body: unknown = null;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) throw dataApiErrorFor(response.status, body, response.headers);

  const envelope = body as Envelope<T> | null;
  if (!envelope || typeof envelope !== "object" || !("data" in envelope)) {
    throw new DataApiError("server", "AI Stupid Level returned an answer this extension does not understand.", {
      status: response.status,
    });
  }
  return { data: envelope.data, rate: readRateInfo(response.headers), generatedAt: envelope.generated_at ?? null };
}

export const modelsPath = (board: string, period: string) =>
  `/models?period=${encodeURIComponent(period)}&sortBy=${encodeURIComponent(board)}`;
export const historyPath = (id: string | number, period: string) =>
  `/models/${encodeURIComponent(String(id))}/history?period=${encodeURIComponent(period)}`;
export const incidentsPath = (limit: number) => `/incidents?limit=${limit}`;

/** GET /drift/:id — the model's drift signature. */
export interface DriftSuiteState {
  cusum: number;
  days: number;
  armed: boolean;
  threshold: number;
  coldStart: number;
  confirm?: number;
  above?: number;
  fired?: boolean;
}

export interface DriftSignature {
  modelId: number;
  modelName: string;
  timestamp?: string | null;
  baselineScore?: number | null;
  currentScore?: number | null;
  regime?: string | null;
  /** The suite the scores above come from ("hourly" is the coding suite). */
  suite?: string | null;
  driftStatus?: "NORMAL" | "WARNING" | "ALERT" | string | null;
  lastSignificantChange?: string | null;
  hoursSinceChange?: number | null;
  dataSource?: "measured" | "synthetic" | string | null;
  pageHinkleyBySuite?: Partial<Record<"hourly" | "tooling" | "deep", DriftSuiteState>> | null;
}

export const driftPath = (id: string | number) => `/drift/${encodeURIComponent(String(id))}`;
