import { readEvents } from './core.js';
import type { ChatCompletion, ChatCompletionChunk, RoutingInfo, TokenUsage, ToolCall } from './types.js';

/** A response object with the routing decision attached as a non-enumerable `routing` property. */
export type WithRouting<T> = T & { readonly routing: RoutingInfo };

export function withRouting<T extends object>(data: T, routing: RoutingInfo): WithRouting<T> {
  // Non-enumerable, so JSON.stringify(completion) stays exactly the OpenAI shape.
  Object.defineProperty(data, 'routing', { value: routing, enumerable: false, configurable: true });
  return data as WithRouting<T>;
}

/**
 * A streamed chat completion. Iterate it for chunks (`for await (const chunk of stream)`), or
 * `textStream()` for the text only, or await `finalCompletion()` for the assembled answer —
 * tool calls included. `routing` is known as soon as the stream opens: the router decides (and
 * falls back, if it must) before the first byte.
 *
 * A stream can be consumed once.
 */
export class ChatStream implements AsyncIterable<ChatCompletionChunk> {
  readonly routing: RoutingInfo;
  private readonly controller: AbortController;
  private consumed = false;
  private chunks: ChatCompletionChunk[] = [];
  private done: Promise<WithRouting<ChatCompletion>> | null = null;

  constructor(private readonly response: Response, routing: RoutingInfo, controller: AbortController) {
    this.routing = routing;
    this.controller = controller;
  }

  /** Stop the stream and close the connection. */
  abort(): void {
    this.controller.abort();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
    if (this.consumed) throw new Error('This stream has already been consumed.');
    this.consumed = true;
    for await (const chunk of readEvents(this.response, this.controller.signal)) {
      this.chunks.push(chunk);
      yield chunk as ChatCompletionChunk;
    }
  }

  /** The answer's text, piece by piece. */
  async *textStream(): AsyncIterable<string> {
    for await (const chunk of this) {
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield text;
    }
  }

  /** Read the stream to the end and return the whole completion (content, tool calls, usage). */
  finalCompletion(): Promise<WithRouting<ChatCompletion>> {
    if (!this.done) {
      this.done = (async () => {
        if (!this.consumed) for await (const _ of this) { /* collect */ }
        return withRouting(assemble(this.chunks, this.routing), this.routing);
      })();
    }
    return this.done;
  }
}

/** Build the chat.completion a sequence of chunks adds up to. */
export function assemble(chunks: ChatCompletionChunk[], routing?: RoutingInfo): ChatCompletion {
  let content = '';
  let finish: ChatCompletion['choices'][0]['finish_reason'] = 'stop';
  let usage: TokenUsage | undefined;
  const calls = new Map<number, ToolCall>();
  const first = chunks[0];
  for (const c of chunks) {
    if (c.usage) usage = c.usage;
    const choice = c.choices?.[0];
    if (!choice) continue;
    if (choice.delta?.content) content += choice.delta.content;
    for (const tc of choice.delta?.tool_calls ?? []) {
      const prev = calls.get(tc.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
      calls.set(tc.index, {
        id: tc.id || prev.id,
        type: 'function',
        function: {
          name: tc.function?.name || prev.function.name,
          arguments: prev.function.arguments + (tc.function?.arguments ?? ''),
        },
      });
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  return {
    id: first?.id ?? routing?.requestId ?? '',
    object: 'chat.completion',
    created: first?.created ?? Math.floor(Date.now() / 1000),
    model: first?.model ?? routing?.model ?? '',
    system_fingerprint: first?.system_fingerprint,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: content || (toolCalls.length ? null : ''),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: finish,
    }],
    ...(usage ? { usage } : {}),
  };
}
