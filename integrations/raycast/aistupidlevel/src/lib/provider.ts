import type { AI } from "@raycast/api";
import type { ChatChunk } from "./router";

/** An OpenAI Chat Completions message, as the Smart Router accepts it. */
export type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface OpenAITool {
  type: "function";
  function: { name: string; description?: string; parameters: unknown };
}

function textOf(parts: unknown): string {
  if (typeof parts === "string") return parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p): p is { type: "text"; text: string } => !!p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n\n");
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}

/**
 * Raycast hands a model provider AI SDK `ModelMessage`s. Convert them to the OpenAI format the
 * Smart Router takes. Image attachments are not declared as a capability, so Raycast does not send
 * them; reasoning from earlier turns is not sent back.
 */
export function toOpenAIMessages(request: Pick<AI.ModelRequest, "system" | "messages">): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (request.system?.trim()) out.push({ role: "system", content: request.system });

  for (const message of request.messages ?? []) {
    switch (message.role) {
      case "system":
        if (message.content.trim()) out.push({ role: "system", content: message.content });
        break;
      case "user":
        out.push({ role: "user", content: textOf(message.content) });
        break;
      case "assistant": {
        const parts = Array.isArray(message.content) ? message.content : [];
        const calls = parts
          .filter((p) => p.type === "tool-call")
          .map((p) => {
            const call = p as { toolCallId: string; toolName: string; input: unknown };
            return {
              id: call.toolCallId,
              type: "function" as const,
              function: { name: call.toolName, arguments: stringify(call.input ?? {}) },
            };
          });
        const text = textOf(message.content);
        out.push({
          role: "assistant",
          content: text || (calls.length ? null : ""),
          ...(calls.length ? { tool_calls: calls } : {}),
        });
        break;
      }
      case "tool":
        for (const result of message.content) {
          const output = result.output as { type?: string; value?: unknown } | undefined;
          out.push({
            role: "tool",
            tool_call_id: result.toolCallId,
            content: stringify(output && "value" in output ? output.value : output),
          });
        }
        break;
    }
  }
  return out;
}

export function toOpenAITools(tools: AI.ModelRequest["tools"]): OpenAITool[] | undefined {
  if (!tools) return undefined;
  const list = Object.entries(tools).map(([name, tool]) => ({
    type: "function" as const,
    function: {
      name,
      ...(tool.description ? { description: tool.description } : {}),
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    },
  }));
  return list.length ? list : undefined;
}

type FinishReason = "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" | "unknown";

function finishReasonOf(reason: string | null, hasToolCalls: boolean): FinishReason {
  switch (reason) {
    case "stop":
      return hasToolCalls ? "tool-calls" : "stop";
    case "length":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool-calls";
    case "content_filter":
      return "content-filter";
    case null:
      return hasToolCalls ? "tool-calls" : "stop";
    default:
      return "other";
  }
}

/**
 * Turn OpenAI streaming chunks into the stream parts Raycast expects: text and reasoning deltas as
 * they arrive, tool calls once their arguments are complete, and a final `finish` with usage.
 */
export async function* toStreamParts(chunks: AsyncIterable<ChatChunk>): AsyncGenerator<AI.ModelStreamPart> {
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let finish: string | null = null;
  let usage: ChatChunk["usage"] = null;

  for await (const chunk of chunks) {
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta;
    if (delta?.reasoning_content) yield { type: "reasoning-delta", text: delta.reasoning_content };
    if (delta?.content) yield { type: "text-delta", text: delta.content };
    for (const tc of delta?.tool_calls ?? []) {
      const prev = calls.get(tc.index) ?? { id: "", name: "", args: "" };
      calls.set(tc.index, {
        id: tc.id || prev.id,
        name: tc.function?.name || prev.name,
        args: prev.args + (tc.function?.arguments ?? ""),
      });
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }

  const ordered = [...calls.entries()].sort((a, b) => a[0] - b[0]);
  for (const [index, call] of ordered) {
    let input: unknown = {};
    if (call.args.trim()) {
      try {
        input = JSON.parse(call.args);
      } catch {
        input = {};
      }
    }
    yield { type: "tool-call", toolCallId: call.id || `call_${index}`, toolName: call.name, input };
  }

  yield {
    type: "finish",
    finishReason: finishReasonOf(finish, ordered.length > 0),
    ...(usage
      ? {
          totalUsage: {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          },
        }
      : {}),
  };
}
