import type { ChatMessage, RoutePreview } from "./router";
import { providerLabel } from "./format";
import { routingModeTitle } from "./constants";

/** A prompt shown as a Markdown quote above the answer, shortened if it is long. */
export function quotePrompt(prompt: string, max = 600): string {
  const text = prompt.trim();
  const short = text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
  return short
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

export type AnswerState = "routing" | "thinking" | "streaming" | "done" | "stopped" | "error";

export function answerMarkdown(opts: {
  prompt: string;
  answer: string;
  state: AnswerState;
  errorMessage?: string | null;
}): string {
  const parts = [quotePrompt(opts.prompt), ""];
  if (opts.answer) parts.push(opts.answer);
  if (opts.state === "routing") parts.push("_Choosing a model…_");
  if (opts.state === "thinking" && !opts.answer) parts.push("_Thinking…_");
  if (opts.state === "stopped") parts.push("", "_Stopped._");
  if (opts.state === "error")
    parts.push("", `**The answer could not be completed.** ${opts.errorMessage ?? ""}`.trim());
  if (opts.state === "done" && !opts.answer) parts.push("_The model returned an empty answer._");
  return parts.join("\n");
}

/** The conversation so far plus a new user turn. */
export function withUserTurn(history: ChatMessage[], prompt: string): ChatMessage[] {
  return [...history, { role: "user", content: prompt }];
}

export function modeLabel(mode: string): string {
  return mode.startsWith("auto") ? routingModeTitle(mode) : `Pinned: ${mode}`;
}

function money(usd: number | null | undefined): string | null {
  if (typeof usd !== "number" || !Number.isFinite(usd)) return null;
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toPrecision(2)}`;
  return `$${usd.toFixed(2)}`;
}

export function previewMarkdown(preview: RoutePreview, prompt: string): string {
  const lines = [quotePrompt(prompt, 300), ""];
  const p = preview.primary;
  lines.push(
    `## ${p.model}`,
    "",
    `${providerLabel(p.provider)}${typeof p.score === "number" ? ` · score ${p.score}` : ""}`,
  );
  const cost = money(p.estimated_cost_usd);
  if (cost) lines.push("", `Router cost estimate for this request: ${cost}`);
  if (p.reasoning) lines.push("", `**Why:** ${p.reasoning}`);
  if (preview.fallbacks?.length) {
    lines.push(
      "",
      "### Fallbacks",
      "",
      "If the first choice fails before answering, the router tries these in order:",
      "",
    );
    preview.fallbacks.forEach((f, i) => {
      lines.push(
        `${i + 1}. \`${f.model}\` (${providerLabel(f.provider)}${typeof f.score === "number" ? `, score ${f.score}` : ""})`,
      );
    });
  } else if (preview.fallback_enabled === false) {
    lines.push("", "Fallback is turned off for this key.");
  }
  lines.push("", "_Preview only: nothing was sent to a provider and nothing was counted._");
  return lines.join("\n");
}
