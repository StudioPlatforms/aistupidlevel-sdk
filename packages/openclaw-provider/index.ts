/**
 * AI Stupid Level provider plugin for OpenClaw.
 *
 * Registers the AI Stupid Level Smart Router, an OpenAI-compatible endpoint, as a model provider.
 * Its model ids are routing modes: `auto-tooling` sends each request to the model that currently
 * scores best on AI Stupid Level's tool-use benchmark, `auto-coding` on its coding benchmark, and
 * so on. The router calls that model with the provider keys saved on the user's AI Stupid Level
 * account. A model id such as `claude-opus-5-5` pins one model.
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth";

export const PROVIDER_ID = "aistupidlevel";
export const API_KEY_ENV = "ASL_ROUTER_KEY";
export const DEFAULT_BASE_URL = "https://aistupidlevel.info/v1";

/** The routing modes, agent-first: also the catalog when /v1/models cannot be reached. */
export const ROUTING_MODES: ReadonlyArray<readonly [string, string]> = [
  ["auto-tooling", "Best for tool use (routed)"],
  ["auto-coding", "Best for coding (routed)"],
  ["auto-reasoning", "Best for reasoning (routed)"],
  ["auto-best", "Best overall (routed)"],
  ["auto-task", "Matched to each request (routed)"],
  ["auto-value", "Best value (routed)"],
];
const MODE_NAMES = new Map(ROUTING_MODES);

/**
 * Limits that hold for every model the router can pick: the smallest context window and output
 * cap across its pool. Cost is zero because the router adds no per-token charge; model usage is
 * billed to the user's own provider accounts.
 */
export function modelRow(id: string) {
  return {
    id,
    name: MODE_NAMES.get(id) ?? id,
    reasoning: false,
    input: ["text"] as Array<"text">,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 64000,
  };
}

export function baseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.ASL_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** Model ids from the authenticated GET /v1/models, routing modes first; null when unreachable. */
export async function fetchModelIds(apiKey: string, url = baseUrl(), fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  try {
    const res = await fetchImpl(`${url}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length === 0) return null;
    const modes = ROUTING_MODES.map(([id]) => id).filter((id) => ids.includes(id));
    return [...modes, ...ids.filter((id) => !MODE_NAMES.has(id))];
  } catch {
    return null;
  }
}

export async function buildCatalog(apiKey: string | undefined, fetchImpl: typeof fetch = fetch) {
  if (!apiKey) return null;
  const url = baseUrl();
  const ids = (await fetchModelIds(apiKey, url, fetchImpl)) ?? ROUTING_MODES.map(([id]) => id);
  return {
    provider: {
      baseUrl: url,
      apiKey,
      api: "openai-completions" as const,
      models: ids.map(modelRow),
    },
  };
}

export function resolveDynamicModel(ctx: { modelId: string }) {
  return { ...modelRow(ctx.modelId), provider: PROVIDER_ID, api: "openai-completions" as const, baseUrl: baseUrl() };
}

export default definePluginEntry({
  id: PROVIDER_ID,
  name: "AI Stupid Level",
  description: "AI Stupid Level Smart Router: each request goes to the model scoring best right now, with your own provider keys",
  register(api) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: "AI Stupid Level",
      docsPath: "https://github.com/StudioPlatforms/aistupidlevel-sdk/tree/main/packages/openclaw-provider#readme",
      envVars: [API_KEY_ENV],
      auth: [
        createProviderApiKeyAuthMethod({
          providerId: PROVIDER_ID,
          methodId: "api-key",
          label: "AI Stupid Level router key",
          hint: "Router key (aism_…) from aistupidlevel.info/router/keys",
          optionKey: "aistupidlevelApiKey",
          flagName: "--aistupidlevel-api-key",
          envVar: API_KEY_ENV,
          promptMessage: "Enter your AI Stupid Level router key",
          defaultModel: `${PROVIDER_ID}/auto-tooling`,
        }),
      ],
      catalog: {
        order: "simple",
        run: async (ctx: { resolveProviderApiKey: (id: string) => { apiKey?: string } }) =>
          buildCatalog(ctx.resolveProviderApiKey(PROVIDER_ID).apiKey),
      },
      resolveDynamicModel,
    } as any);
  },
});
