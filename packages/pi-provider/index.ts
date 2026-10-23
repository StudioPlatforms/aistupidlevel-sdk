/**
 * AI Stupid Level provider for Pi.
 *
 * Registers the AI Stupid Level Smart Router, an OpenAI-compatible endpoint, as the `aistupidlevel`
 * provider. Its model ids are routing modes: `auto-coding` sends each request to the model with the
 * best measured score on AI Stupid Level's coding benchmark, `auto-tooling` on its tool-use
 * benchmark, and so on. The router calls that model with the provider keys saved on the user's AI
 * Stupid Level account. A model id such as `claude-opus-5-5` pins one model.
 *
 * Requests go through pi-ai's built-in OpenAI Chat Completions implementation, so streaming, tool
 * calls, usage and cancellation behave as they do for Pi's own providers. The footer shows which
 * model answered, from the router's `X-AISM-Model` response header.
 */
import {
  type ApiKeyAuth,
  createProvider,
  envApiKeyAuth,
  type Model,
  type Provider,
  type RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const PROVIDER_ID = "aistupidlevel";
export const PROVIDER_NAME = "AI Stupid Level";
export const DEFAULT_BASE_URL = "https://aistupidlevel.info/v1";
/** Read in this order when no key was stored with `/login`. */
export const API_KEY_ENV_VARS = ["AISTUPIDLEVEL_API_KEY", "ASL_ROUTER_KEY"] as const;
export const KEYS_URL = "https://aistupidlevel.info/router/keys";
/** Footer status key: the model that answered the latest request. */
export const STATUS_KEY = "aistupidlevel";

/**
 * Limits that hold for any model the router can pick: the smallest context window and output cap
 * across its pool.
 */
export const CONTEXT_WINDOW = 262_144;
export const MAX_TOKENS = 64_000;

/** The routing modes with their display names, in catalog order. */
export const ROUTING_MODES: ReadonlyArray<readonly [id: string, name: string]> = [
  ["auto-coding", "Best for coding (routed)"],
  ["auto-tooling", "Best for tool use (routed)"],
  ["auto-reasoning", "Best for reasoning (routed)"],
  ["auto-best", "Best overall (routed)"],
  ["auto-task", "Matched to each request (routed)"],
  ["auto-value", "Best value (routed)"],
  ["auto-fastest-quality", "Fastest near the top (routed)"],
  ["auto", "Your saved strategy (routed)"],
  ["auto-value-coding", "Best value for coding (routed)"],
  ["auto-value-reasoning", "Best value for reasoning (routed)"],
  ["auto-value-tooling", "Best value for tool use (routed)"],
  ["auto-consistent", "Steadiest near the top (routed)"],
  ["auto-cheapest", "Cheapest (routed)"],
  ["auto-fastest", "Fastest (routed)"],
  ["auto-split", "Your custom split (routed)"],
];
const MODE_NAMES = new Map(ROUTING_MODES);

/**
 * The main routing modes, `auto-coding` first so it is the default. They are listed before the
 * live catalog has been fetched, and stay listed when it cannot be.
 */
export const FALLBACK_MODES: readonly string[] = ROUTING_MODES.slice(0, 8).map(([id]) => id);

/**
 * One catalog entry. Text only: the router does not route image input. Cost is zero because the
 * router adds no per-token charge; the routed provider bills the user's own key, at a price that
 * depends on which model answered.
 *
 * The entry always names the public router. Pi keeps the fetched list between runs, so an endpoint
 * stored in it would outlive a change of configuration; another endpoint (a proxy) is set with a
 * `baseUrl` for `aistupidlevel` in Pi's models.json, which Pi applies over these entries.
 */
export function modelRow(id: string): Model<"openai-completions"> {
  return {
    id,
    name: MODE_NAMES.get(id) ?? id,
    api: "openai-completions",
    provider: PROVIDER_ID,
    baseUrl: DEFAULT_BASE_URL,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: CONTEXT_WINDOW,
    maxTokens: MAX_TOKENS,
  };
}

/**
 * Model ids from the authenticated `GET /v1/models`, routing modes first. Throws when the list
 * cannot be read, so Pi keeps the list it already has.
 */
export async function fetchModelIds(
  apiKey: string,
  baseUrl: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetchImpl(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    throw new Error(`${PROVIDER_NAME}: GET ${baseUrl}/models answered HTTP ${response.status}`);
  }
  const body = (await response.json()) as { data?: unknown };
  const entries: unknown[] = Array.isArray(body?.data) ? body.data : [];
  const ids = [
    ...new Set(
      entries
        .map((entry) => (entry as { id?: unknown } | null)?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (ids.length === 0) throw new Error(`${PROVIDER_NAME}: GET ${baseUrl}/models listed no models`);
  const modes = ROUTING_MODES.map(([id]) => id).filter((id) => ids.includes(id));
  return [...modes, ...ids.filter((id) => !MODE_NAMES.has(id))];
}

/**
 * A key stored with `/login` wins, then `AISTUPIDLEVEL_API_KEY`, then `ASL_ROUTER_KEY`. The login
 * prompt says where to create a key.
 */
export function routerKeyAuth(): ApiKeyAuth {
  return {
    ...envApiKeyAuth(`${PROVIDER_NAME} router key`, API_KEY_ENV_VARS),
    async login(interaction) {
      interaction.signal.throwIfAborted();
      const entered = await interaction.prompt({
        type: "secret",
        message: `${PROVIDER_NAME} router key (create one at ${KEYS_URL})`,
        placeholder: "aism_...",
      });
      interaction.signal.throwIfAborted();
      const key = entered.trim();
      if (!key) throw new Error("No router key was entered.");
      return { type: "api_key", key };
    },
  };
}

export function createAistupidlevelProvider(options: { fetch?: typeof fetch } = {}): Provider<"openai-completions"> {
  return createProvider<"openai-completions">({
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    baseUrl: DEFAULT_BASE_URL,
    auth: { apiKey: routerKeyAuth() },
    models: FALLBACK_MODES.map(modelRow),
    api: openAICompletionsApi(),
    async fetchModels(context: RefreshModelsContext) {
      const key = context.credential?.type === "api_key" ? context.credential.key : undefined;
      if (!key) throw new Error(`${PROVIDER_NAME}: no router key`);
      // The provider's endpoint as Pi composed it, including a models.json override.
      const baseUrl = (context.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
      const ids = await fetchModelIds(key, baseUrl, context.signal, options.fetch);
      return ids.map(modelRow);
    },
  });
}

/** The model that answered, from the router's `X-AISM-Model` response header. */
export function answeredBy(headers: Record<string, string> | undefined): string | undefined {
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() === "x-aism-model" && value) return value;
  }
  return undefined;
}

function setStatus(ctx: ExtensionContext, text: string | undefined): void {
  try {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, text);
  } catch {
    // The context of a replaced session throws: there is no footer left to update.
  }
}

export default function aistupidlevel(pi: ExtensionAPI): void {
  pi.registerProvider(createAistupidlevelProvider());

  // Setting a status repaints the footer, so an unchanged line is left alone.
  let shown: string | undefined;
  const show = (ctx: ExtensionContext, text: string | undefined): void => {
    if (text === shown) return;
    shown = text;
    setStatus(ctx, text);
  };

  pi.on("after_provider_response", (event, ctx) => {
    const model = answeredBy(event.headers);
    if (model) show(ctx, `ASL → ${model}`);
  });

  pi.on("model_select", (event, ctx) => {
    if (event.model.provider !== PROVIDER_ID) show(ctx, undefined);
  });
}
