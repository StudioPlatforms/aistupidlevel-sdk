export const SITE_URL = "https://aistupidlevel.info";
export const DATA_API_URL = `${SITE_URL}/api/v1`;
export const ROUTER_API_URL = `${SITE_URL}/v1`;

export const DATA_KEYS_URL = `${SITE_URL}/account/data-keys`;
export const ROUTER_KEYS_URL = `${SITE_URL}/router/keys`;
export const PROVIDER_KEYS_URL = `${SITE_URL}/router/providers`;
export const PRICING_URL = `${SITE_URL}/pricing`;
export const API_DOCS_URL = `${SITE_URL}/api-docs`;
export const ROUTER_DOCS_URL = `${SITE_URL}/router/docs`;
export const STATUS_URL = `${SITE_URL}/status`;

export const modelPageUrl = (id: string | number) => `${SITE_URL}/models/${encodeURIComponent(String(id))}`;

/** How long a Data API answer is reused before the network is asked again. The free tier allows 10 requests a day. */
export const DATA_CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Leaderboards. `value` is the Data API `sortBy` parameter. The coding board is `7axis`
 * (the hourly coding suite), the same mapping the website uses.
 */
export const BOARDS = [
  { value: "combined", title: "Combined" },
  { value: "7axis", title: "Coding" },
  { value: "reasoning", title: "Reasoning" },
  { value: "tooling", title: "Tool Use" },
] as const;
export type Board = (typeof BOARDS)[number]["value"];

/** Score periods. `latest` (the newest run) needs a paid plan; free keys read 24h, 7d and 1m. */
export const PERIODS = [
  { value: "24h", title: "Last 24 Hours" },
  { value: "7d", title: "Last 7 Days" },
  { value: "1m", title: "Last 30 Days" },
  { value: "latest", title: "Latest Run (Paid Plans)" },
] as const;
export type Period = (typeof PERIODS)[number]["value"];

export function isBoard(value: unknown): value is Board {
  return BOARDS.some((b) => b.value === value);
}
export function isPeriod(value: unknown): value is Period {
  return PERIODS.some((p) => p.value === value);
}
export function boardTitle(value: Board): string {
  return BOARDS.find((b) => b.value === value)?.title ?? value;
}
export function periodTitle(value: Period): string {
  return PERIODS.find((p) => p.value === value)?.title ?? value;
}

/** Smart Router routing modes, sent as the `model` of a request. */
export const ROUTING_MODES = [
  { id: "auto-best", title: "Best Overall", description: "The highest combined benchmark score." },
  { id: "auto-coding", title: "Coding", description: "The top model on the coding benchmark." },
  { id: "auto-reasoning", title: "Reasoning", description: "The top model on the reasoning benchmark." },
  { id: "auto-tooling", title: "Tool Use", description: "The top model on the tool-use benchmark." },
  { id: "auto-task", title: "Match the Task", description: "Reads the request and picks the matching benchmark." },
  {
    id: "auto-value",
    title: "Best Value",
    description: "Most benchmark points per measured dollar, among models within 5 points of the best.",
  },
  {
    id: "auto-value-coding",
    title: "Best Value for Coding",
    description: "Most coding points per measured dollar, among models within 5 points of the best.",
  },
  {
    id: "auto-fastest-quality",
    title: "Fastest Near the Top",
    description: "The fastest model within 5 points of the best.",
  },
  { id: "auto", title: "My Saved Strategy", description: "The routing strategy saved on your account." },
] as const;
export type RoutingModeId = (typeof ROUTING_MODES)[number]["id"];

export function routingModeTitle(id: string): string {
  return ROUTING_MODES.find((m) => m.id === id)?.title ?? id;
}
