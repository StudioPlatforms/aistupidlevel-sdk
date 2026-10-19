/**
 * Request and response types for the AI Stupid Level Smart Router (/v1).
 * They follow the OpenAI Chat Completions format, so code written against OpenAI's types ports
 * over directly. The source of truth is https://aistupidlevel.info/v1/openapi.json.
 */

/** Routing modes. "auto" uses the routing preference saved on your account. */
export const ROUTING_MODES = [
  'auto',
  'auto-best',
  'auto-coding',
  'auto-reasoning',
  'auto-tooling',
  'auto-agentic',
  'auto-value',
  'auto-value-coding',
  'auto-value-reasoning',
  'auto-value-tooling',
  'auto-value-agentic',
  'auto-consistent',
  'auto-fastest-quality',
  'auto-fastest',
  'auto-cheapest',
  'auto-task',
  'auto-split',
] as const;

export type RoutingMode = (typeof ROUTING_MODES)[number];

/** A routing mode, or a model id from `models.list()` to pin one model. */
export type ModelId = RoutingMode | (string & {});

export type Role = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: Role;
  /** Text only: the router does not route image, audio or file parts. */
  content: string | TextPart[] | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface FunctionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    /** JSON Schema of the arguments. */
    parameters?: Record<string, unknown>;
  };
}

export type ToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } };

export interface ChatCompletionCreateParams {
  model: ModelId;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  tools?: FunctionTool[];
  tool_choice?: ToolChoice;
  parallel_tool_calls?: boolean;
  response_format?: ResponseFormat;
  /** Mapped by the router to the nearest level the chosen model supports. */
  reasoning_effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  stop?: string | string[];
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
  /** Only 1 is supported. */
  n?: 1;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
  refusal?: string | null;
}

export interface ChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  /** The model that answered (which may differ from the routing mode you asked for). */
  model: string;
  system_fingerprint?: string;
  choices: Array<{
    index: number;
    message: AssistantMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls';
    logprobs?: unknown;
  }>;
  usage?: TokenUsage;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  system_fingerprint?: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<Partial<ToolCall> & { index: number; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | null;
  }>;
  usage?: TokenUsage;
}

/** The routing decision behind a response, read from the X-AISM-* headers. */
export interface RoutingInfo {
  /** Provider that answered: openai, anthropic, google, deepseek, kimi or glm. */
  provider: string | null;
  /** Model that answered. */
  model: string | null;
  /** Why it was chosen, including any fallback. */
  reasoning: string | null;
  /** Router-measured time to the answer, in ms (non-streaming). */
  latencyMs: number | null;
  /** The request id (same as the completion id). Quote it when reporting a problem. */
  requestId: string | null;
  /** True when the answer is a sandbox mock. */
  sandbox: boolean;
  /** True when the response was replayed for a repeated Idempotency-Key. */
  replayed: boolean;
  /** True when the first choice failed and a fallback answered. */
  fallback: boolean;
}

export interface RouteSelection {
  model: string;
  provider: string;
  score: number;
  reasoning: string;
  estimated_cost_usd: number | null;
}

export interface RoutePreview {
  object: 'route.preview';
  requested_model: string;
  /** The routing strategy used, or "pinned". */
  strategy: string;
  sandbox: boolean;
  primary: RouteSelection;
  fallbacks: RouteSelection[];
  fallback_enabled: boolean;
}

export interface Usage {
  object: 'usage';
  period: string;
  plan: string;
  requests: { used: number; included: number | null; remaining: number | null; unlimited: boolean };
  credits: { requests: number; in_use: boolean };
  /** Whether a routed request would be accepted now. */
  allowed: boolean;
  key: {
    id: number;
    name: string;
    prefix: string;
    project_id: number | null;
    expires_at: string | null;
    budget: { monthly_limit_usd: number | null; hard_limit: boolean; spent_this_month_usd: number };
  } | null;
}

export interface ModelList {
  object: 'list';
  data: Array<{ id: string; object: string; created: number; owned_by: string }>;
}

export interface EmbeddingCreateParams {
  model?: 'auto-embedding' | 'text-embedding-3-small' | 'text-embedding-3-large' | (string & {});
  input: string | string[];
  dimensions?: number;
  encoding_format?: 'float' | 'base64';
}

export interface EmbeddingResponse {
  object: 'list';
  model: string;
  data: Array<{ object: 'embedding'; index: number; embedding: number[] }>;
  usage: { prompt_tokens: number; total_tokens: number };
}

/** Sandbox failures the server can simulate (X-ASL-Sandbox-Simulate). */
export type SandboxSimulation =
  | 'fallback'
  | 'rate_limited'
  | 'allowance_exhausted'
  | 'insufficient_quota'
  | 'provider_key_rejected'
  | 'model_unavailable'
  | 'server_error';

export interface RequestOptions {
  /** Cancel the request. */
  signal?: AbortSignal;
  /** Per-request timeout in ms (default: the client's). */
  timeout?: number;
  /** Per-request retry limit (default: the client's). */
  maxRetries?: number;
  /** Extra headers for this request. */
  headers?: Record<string, string>;
  /** Idempotency key for a non-streaming request; one is generated if omitted (see autoIdempotency). */
  idempotencyKey?: string;
  /** Override the client's sandbox setting for this request. */
  sandbox?: boolean;
  /** Sandbox only: make the request fall back or fail this way. */
  simulate?: SandboxSimulation;
}
