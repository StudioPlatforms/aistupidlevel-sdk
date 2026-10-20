import type { DriftSignature, DriftSuiteState, HistoryPoint, Incident, ModelScore } from "./data-api";

// ── Leaderboard ─────────────────────────────────────────────────────────────

export interface RankedModel {
  model: ModelScore;
  /** Competition rank among ranked models (1, 2, 2, 4 …); null when the model is not ranked. */
  rank: number | null;
  /** True when another ranked model has the same published score. */
  tied: boolean;
}

export function numericScore(model: ModelScore): number | null {
  return typeof model.currentScore === "number" && Number.isFinite(model.currentScore) ? model.currentScore : null;
}

/**
 * Rank rows in the order the API returned them. Equal published scores share a rank, as on the
 * website ("=1"). Rows that are not rankable (stale) or unavailable keep their place but get no rank.
 */
export function rankModels(rows: ModelScore[]): RankedModel[] {
  const ranked = rows.filter((m) => m.rankable !== false && numericScore(m) !== null);
  const counts = new Map<number, number>();
  for (const m of ranked) counts.set(numericScore(m)!, (counts.get(numericScore(m)!) ?? 0) + 1);

  const rankOf = new Map<ModelScore, number>();
  let position = 0;
  let previous: number | null = null;
  let currentRank = 0;
  for (const m of ranked) {
    position += 1;
    const score = numericScore(m)!;
    if (score !== previous) currentRank = position;
    previous = score;
    rankOf.set(m, currentRank);
  }

  return rows.map((model) => {
    const rank = rankOf.get(model) ?? null;
    const score = numericScore(model);
    return { model, rank, tied: rank !== null && score !== null && (counts.get(score) ?? 0) > 1 };
  });
}

export function rankLabel(entry: RankedModel): string {
  if (entry.rank === null) return "–";
  return entry.tied ? `=${entry.rank}` : `${entry.rank}`;
}

export function modelTitle(model: Pick<ModelScore, "displayName" | "name">): string {
  return model.displayName?.trim() || model.name;
}

const PROVIDERS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  deepseek: "DeepSeek",
  kimi: "Moonshot AI",
  glm: "Z.ai",
  xai: "xAI",
  mistral: "Mistral",
};

export function providerLabel(provider: string | null | undefined): string {
  if (!provider) return "Unknown";
  return PROVIDERS[provider.toLowerCase()] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

export type Tone = "good" | "fair" | "warning" | "bad" | "none";

/** The website's bands: excellent 80+, good 65–79, warning 40–64, critical below 40. */
export function statusTone(status: string | null | undefined): Tone {
  switch (status) {
    case "excellent":
      return "good";
    case "good":
      return "fair";
    case "warning":
      return "warning";
    case "critical":
      return "bad";
    default:
      return "none";
  }
}

export function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case "excellent":
      return "Excellent";
    case "good":
      return "Good";
    case "warning":
      return "Warning";
    case "critical":
      return "Critical";
    default:
      return "Unavailable";
  }
}

export function trendLabel(trend: string | null | undefined): string {
  switch (trend) {
    case "up":
      return "Improving";
    case "down":
      return "Declining";
    case "stable":
      return "Stable";
    default:
      return "No Trend Yet";
  }
}

export function scoreText(model: ModelScore): string {
  const score = numericScore(model);
  return score === null ? "n/a" : String(score);
}

const SUITES: Record<string, string> = {
  hourly: "Coding",
  deep: "Reasoning",
  tooling: "Tool Use",
  canary: "Canary",
};

export function suiteLabel(suite: string): string {
  return SUITES[suite] ?? suite;
}

// ── Time ────────────────────────────────────────────────────────────────────

export function relativeTime(iso: string | number | null | undefined, now: number = Date.now()): string {
  if (iso === null || iso === undefined || iso === "") return "unknown";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown";
  const seconds = Math.round((now - t) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

export function formatDuration(fromIso: string, toIso: string | null, now: number = Date.now()): string {
  const from = Date.parse(fromIso);
  const to = toIso ? Date.parse(toIso) : now;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return "unknown";
  const minutes = Math.round((to - from) / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h`;
}

/** "2026-10-20 06:00 UTC": unambiguous for a team spread across time zones. */
export function utcStamp(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown";
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// ── History ─────────────────────────────────────────────────────────────────

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** A text sparkline, oldest value first. A flat series draws at mid height. */
export function sparkline(values: number[]): string {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return "";
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return finite
    .map((v) => {
      if (max === min) return BLOCKS[3];
      const i = Math.round(((v - min) / (max - min)) * (BLOCKS.length - 1));
      return BLOCKS[i];
    })
    .join("");
}

/** History points newest first, as the API returns them, filtered to real scores. */
export function scoredPoints(points: HistoryPoint[]): HistoryPoint[] {
  return points
    .filter((p) => typeof p.score === "number" && Number.isFinite(p.score) && Number.isFinite(Date.parse(p.timestamp)))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export interface HistorySummary {
  count: number;
  newest: number | null;
  oldest: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
  /** Oldest to newest, for drawing. */
  series: number[];
}

export function summarizeHistory(points: HistoryPoint[]): HistorySummary {
  const scored = scoredPoints(points);
  const series = scored.map((p) => p.score as number).reverse();
  if (series.length === 0) return { count: 0, newest: null, oldest: null, min: null, max: null, mean: null, series };
  const sum = series.reduce((a, b) => a + b, 0);
  return {
    count: series.length,
    newest: series[series.length - 1],
    oldest: series[0],
    min: Math.min(...series),
    max: Math.max(...series),
    mean: Math.round((sum / series.length) * 10) / 10,
    series,
  };
}

const AXES: Record<string, string> = {
  correctness: "Correctness",
  spec: "Spec Compliance",
  codeQuality: "Code Quality",
  efficiency: "Efficiency",
  stability: "Stability",
  refusal: "Refusal",
  recovery: "Recovery",
};

export function axisLabel(key: string): string {
  if (AXES[key]) return AXES[key];
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A 0–1 axis value as a 10-cell bar and a whole percentage, e.g. "█████████░ 95%". */
export function axisBar(value: number, width = 10): string {
  const v = Math.min(1, Math.max(0, value));
  const filled = Math.round(v * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${Math.round(v * 100)}%`;
}

/** The axes of the newest point that has them, in a stable order. */
export function newestAxes(points: HistoryPoint[]): { timestamp: string; axes: [string, number][] } | null {
  for (const p of scoredPoints(points)) {
    if (!p.axes) continue;
    const axes = Object.entries(p.axes).filter((e): e is [string, number] => typeof e[1] === "number");
    if (axes.length === 0) continue;
    const order = Object.keys(AXES);
    axes.sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a[0].localeCompare(b[0]);
    });
    return { timestamp: p.timestamp, axes };
  }
  return null;
}

/** Markdown for the model detail screen. Uses only what the API returned. */
export function historyMarkdown(title: string, points: HistoryPoint[], periodTitle: string, now = Date.now()): string {
  const summary = summarizeHistory(points);
  const lines: string[] = [`# ${escapeMarkdown(title)}`, ""];
  if (summary.count === 0) {
    lines.push(`No scored runs in this period (${periodTitle}).`);
    return lines.join("\n");
  }
  lines.push(`**Combined score, ${periodTitle.toLowerCase()}** · ${summary.count} runs`, "");
  lines.push("```", `${sparkline(summary.series)}   ${summary.oldest} → ${summary.newest}`, "```", "");

  const axes = newestAxes(points);
  if (axes) {
    lines.push(`### Axes of the Newest Run (${relativeTime(axes.timestamp, now)})`, "", "```");
    const width = Math.max(...axes.axes.map(([k]) => axisLabel(k).length));
    for (const [key, value] of axes.axes) lines.push(`${axisLabel(key).padEnd(width)}  ${axisBar(value)}`);
    lines.push("```", "");
  }

  lines.push("### Runs", "", "| Time (UTC) | Score |", "| --- | ---: |");
  for (const p of scoredPoints(points).slice(0, 12)) lines.push(`| ${utcStamp(p.timestamp)} | ${p.score} |`);
  return lines.join("\n");
}

// ── Incidents ───────────────────────────────────────────────────────────────

export function isActive(incident: Incident): boolean {
  return !incident.resolvedAt;
}

export function severityTone(severity: string | null | undefined): Tone {
  switch (severity) {
    case "critical":
      return "bad";
    case "major":
    case "high":
    case "warning":
      return "warning";
    case "minor":
    case "medium":
    case "low":
      return "fair";
    default:
      return "none";
  }
}

export function severityLabel(severity: string | null | undefined): string {
  if (!severity) return "Unknown";
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

const INCIDENT_TYPES: Record<string, string> = {
  provider_wide_degradation: "Provider-Wide Degradation",
  performance_drift: "Performance Drift",
  service_disruption: "Service Disruption",
};

export function incidentTypeLabel(type: string | null | undefined): string {
  if (!type) return "Incident";
  return INCIDENT_TYPES[type] ?? axisLabel(type);
}

/**
 * Incident titles arrive as stored alerts, e.g. "PROVIDER INCIDENT: OPENAI — 5/8 models affected".
 * Present them in sentence case without inventing anything.
 */
export function incidentTitle(incident: Incident): string {
  const affected = incident.metadata?.affectedModels;
  if (incident.incidentType === "provider_wide_degradation" && incident.provider) {
    const m = /(\d+)\s*\/\s*(\d+)/.exec(incident.title);
    const share = m ? `${m[1]} of ${m[2]} models` : affected?.length ? `${affected.length} models` : "several models";
    return `${providerLabel(incident.provider)}: ${share} degraded`;
  }
  const raw = incident.title?.trim() || incidentTypeLabel(incident.incidentType);
  if (raw === raw.toUpperCase()) return raw.charAt(0) + raw.slice(1).toLowerCase();
  return raw;
}

/** Active first (newest detection first), then resolved (newest resolution first). */
export function sortIncidents(incidents: Incident[]): { active: Incident[]; resolved: Incident[] } {
  const by = (key: (i: Incident) => string | null) => (a: Incident, b: Incident) =>
    (Date.parse(key(b) ?? "") || 0) - (Date.parse(key(a) ?? "") || 0);
  return {
    active: incidents.filter(isActive).sort(by((i) => i.detectedAt)),
    resolved: incidents.filter((i) => !isActive(i)).sort(by((i) => i.resolvedAt)),
  };
}

// ── Misc ────────────────────────────────────────────────────────────────────

export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]#<>|])/g, "\\$1");
}

/** "8 of 10 requests left today", or null when the server did not say. */
export function quotaText(rate: { limit: number | null; remaining: number | null } | null | undefined): string | null {
  if (!rate || rate.limit === null || rate.remaining === null) return null;
  return `${rate.remaining} of ${rate.limit} API requests left today`;
}

// ── Drift ───────────────────────────────────────────────────────────────────

export function driftStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "WARNING":
      return "Warning";
    case "ALERT":
      return "Alert";
    case "NORMAL":
      return "Normal";
    default:
      return "Unknown";
  }
}

export function driftTone(status: string | null | undefined): Tone {
  switch (status) {
    case "NORMAL":
      return "good";
    case "WARNING":
      return "warning";
    case "ALERT":
      return "bad";
    default:
      return "none";
  }
}

/** Same reading as the website: alert once fired, warning at half the threshold, else OK. */
export function suiteDriftState(s: DriftSuiteState): "warming up" | "ok" | "warning" | "alert" {
  if (!s.armed) return "warming up";
  if (s.fired ?? s.cusum >= s.threshold) return "alert";
  if (s.cusum >= s.threshold / 2) return "warning";
  return "ok";
}

const SUITE_ORDER = ["hourly", "tooling", "deep"] as const;

export function driftMarkdown(title: string, sig: DriftSignature, now = Date.now()): string {
  const lines = [`# ${escapeMarkdown(title)}`, ""];
  if (sig.dataSource === "synthetic" || !sig.pageHinkleyBySuite) {
    lines.push("No measured drift signature for this model yet.");
    return lines.join("\n");
  }
  lines.push(`**Drift status: ${driftStatusLabel(sig.driftStatus)}**`, "");
  if (sig.lastSignificantChange) {
    lines.push(
      `Last significant change: ${utcStamp(sig.lastSignificantChange)} (${relativeTime(sig.lastSignificantChange, now)}).`,
      "",
    );
  }
  lines.push(
    "Each suite runs its own Page-Hinkley change detector on its daily scores. A detector can fire only after " +
      "it has enough measured days on the current test configuration (until then it is warming up).",
    "",
    "| Suite | Detector | Statistic | Fires At | Measured Days |",
    "| --- | --- | ---: | ---: | ---: |",
  );
  for (const key of SUITE_ORDER) {
    const s = sig.pageHinkleyBySuite[key];
    if (!s) continue;
    const confirm = s.confirm ?? 1;
    const firesAt = confirm > 1 ? `${s.threshold.toFixed(2)} for ${confirm} days` : s.threshold.toFixed(2);
    const days = s.armed ? `${s.days}` : `${Math.min(s.days, s.coldStart)} of ${s.coldStart}`;
    lines.push(`| ${suiteLabel(key)} | ${suiteDriftState(s)} | ${s.cusum.toFixed(3)} | ${firesAt} | ${days} |`);
  }
  return lines.join("\n");
}
