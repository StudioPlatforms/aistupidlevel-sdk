/**
 * Errors thrown by the client. Every error says whose problem it is (`party`), whether retrying
 * can help (`retryable`), and carries the router's error code and request id when there is one.
 */

/** Who has to act: the caller's request, the account (allowance or budget), the caller's provider
 *  key or account, the provider itself, the router, or the network in between. */
export type ErrorParty = 'request' | 'account' | 'provider_key' | 'provider' | 'router' | 'network';

export interface ErrorDetails {
  status?: number;
  code?: string | null;
  type?: string | null;
  param?: string | null;
  requestId?: string | null;
  retryAfterMs?: number | null;
  body?: unknown;
  headers?: Record<string, string>;
  cause?: unknown;
}

export class ASLError extends Error {
  readonly status: number | undefined;
  /** The router's error code (e.g. allowance_exhausted, model_not_found). */
  readonly code: string | null;
  readonly type: string | null;
  readonly param: string | null;
  readonly requestId: string | null;
  /** Server-suggested wait before retrying, when it sent one. */
  readonly retryAfterMs: number | null;
  readonly body: unknown;
  readonly headers: Record<string, string>;
  /** Whether a retry can succeed. The client has already retried these up to maxRetries. */
  readonly retryable: boolean = false;
  readonly party: ErrorParty = 'router';

  constructor(message: string, details: ErrorDetails = {}) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.name = new.target.name;
    this.status = details.status;
    this.code = details.code ?? null;
    this.type = details.type ?? null;
    this.param = details.param ?? null;
    this.requestId = details.requestId ?? null;
    this.retryAfterMs = details.retryAfterMs ?? null;
    this.body = details.body;
    this.headers = details.headers ?? {};
  }
}

/** The request itself is wrong (400/404/413/422): invalid messages, unknown model, reused idempotency key. */
export class BadRequestError extends ASLError { override readonly party = 'request' as const; }
/** Missing, invalid or expired router key (401). */
export class AuthenticationError extends ASLError { override readonly party = 'request' as const; }
/** The key may not do this (403). */
export class PermissionDeniedError extends ASLError { override readonly party = 'account' as const; }
/** A request with the same idempotency key is still running (409). Retried automatically. */
export class ConflictError extends ASLError { override readonly retryable = true; override readonly party = 'router' as const; }
/** Too many requests right now (429 rate_limited). Retried automatically, honouring Retry-After. */
export class RateLimitError extends ASLError { override readonly retryable = true; override readonly party = 'account' as const; }
/** The plan's monthly allowance is used up and there are no prepaid credits (429). Not retried. */
export class AllowanceExhaustedError extends ASLError { override readonly party = 'account' as const; }
/** The key's (or project's) hard budget is reached (429 insufficient_quota). Not retried. */
export class BudgetExceededError extends ASLError { override readonly party = 'account' as const; }
/** Your provider account refused for credit or quota (429 provider_quota_exceeded). Not retried. */
export class ProviderQuotaError extends ASLError { override readonly party = 'provider_key' as const; }
/** No working provider key: missing (no_provider_keys) or refused by the provider (provider_key_rejected). */
export class ProviderKeyError extends ASLError { override readonly party = 'provider_key' as const; }
/** Your routing preferences exclude every model (no_routable_model). */
export class NoRoutableModelError extends ASLError { override readonly party = 'request' as const; }
/** The provider refused the request itself (provider_rejected_request), in the provider's words. */
export class ProviderRejectedError extends ASLError { override readonly party = 'request' as const; }
/** Every model in the chain failed provider-side (502 model_unavailable). Retried automatically. */
export class ModelUnavailableError extends ASLError { override readonly retryable = true; override readonly party = 'provider' as const; }
/** A forced tool call was answered without one on every model tried (502 tool_choice_not_honoured). */
export class ToolChoiceNotHonouredError extends ASLError { override readonly party = 'provider' as const; }
/** A 5xx from the router. Retried automatically. */
export class ServerError extends ASLError { override readonly retryable = true; override readonly party = 'router' as const; }
/** The connection failed before a response arrived. Retried automatically. */
export class ConnectionError extends ASLError { override readonly retryable = true; override readonly party = 'network' as const; }
/** No response within the timeout. Retried automatically. */
export class TimeoutError extends ASLError { override readonly retryable = true; override readonly party = 'network' as const; }
/** The request was cancelled through its AbortSignal. Not retried. */
export class AbortError extends ASLError { override readonly party = 'request' as const; }
/** A stream stopped after the answer had started (the router can only fall back before the first byte). */
export class StreamInterruptedError extends ASLError { override readonly party = 'provider' as const; }

/** The error class for an HTTP error response, from its status and the router's error code. */
export function errorFor(status: number, body: any, headers: Record<string, string>, retryAfterMs: number | null): ASLError {
  const err = body && typeof body === 'object' && body.error && typeof body.error === 'object' ? body.error : {};
  const code: string | null = typeof err.code === 'string' ? err.code : null;
  const message = typeof err.message === 'string' && err.message ? err.message : `HTTP ${status}`;
  const details: ErrorDetails = {
    status, code, type: err.type ?? null, param: err.param ?? null,
    requestId: headers['x-aism-request-id'] ?? null, retryAfterMs, body, headers,
  };
  switch (code) {
    case 'allowance_exhausted': return new AllowanceExhaustedError(message, details);
    case 'insufficient_quota': return new BudgetExceededError(message, details);
    case 'provider_quota_exceeded': return new ProviderQuotaError(message, details);
    case 'provider_key_rejected':
    case 'no_provider_keys': return new ProviderKeyError(message, details);
    case 'no_routable_model': return new NoRoutableModelError(message, details);
    case 'provider_rejected_request': return new ProviderRejectedError(message, details);
    case 'model_unavailable': return new ModelUnavailableError(message, details);
    case 'tool_choice_not_honoured': return new ToolChoiceNotHonouredError(message, details);
    case 'idempotency_in_progress': return new ConflictError(message, details);
    case 'rate_limited': return new RateLimitError(message, details);
  }
  if (status === 401) return new AuthenticationError(message, details);
  if (status === 403) return new PermissionDeniedError(message, details);
  if (status === 409) return new ConflictError(message, details);
  if (status === 429) return new RateLimitError(message, details);
  if (status >= 500) return new ServerError(message, details);
  return new BadRequestError(message, details);
}
