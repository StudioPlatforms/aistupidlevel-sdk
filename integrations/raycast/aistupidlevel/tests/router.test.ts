import assert from "node:assert/strict";
import { test } from "node:test";
import { answerMarkdown, modeLabel, previewMarkdown, quotePrompt, withUserTurn } from "../src/lib/conversation";
import { PROVIDER_KEYS_URL, PRICING_URL, ROUTER_KEYS_URL } from "../src/lib/constants";
import { toOpenAIMessages, toOpenAITools, toStreamParts } from "../src/lib/provider";
import {
  type ChatChunk,
  RouterError,
  type RoutePreview,
  chatDeltas,
  parseChunks,
  previewRoute,
  routerErrorFor,
  routingFromHeaders,
  sseData,
  streamChat,
} from "../src/lib/router";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

async function* from<T>(items: T[]): AsyncGenerator<T> {
  for (const i of items) yield i;
}

const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra: Record<string, unknown> = {}) => ({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...extra,
});

// ── Routing headers and errors ──────────────────────────────────────────────

test("routing comes from the X-AISM headers", () => {
  const r = routingFromHeaders(
    new Headers({
      "x-aism-model": "claude-opus-5-5",
      "x-aism-provider": "anthropic",
      "x-aism-reasoning": "Top coding score (99). Fallback activated: gpt-6-sol timed out",
      "x-aism-latency": "812",
      "x-aism-request-id": "req_123",
      "x-aism-sandbox": "true",
    }),
  );
  assert.deepEqual(r, {
    model: "claude-opus-5-5",
    provider: "anthropic",
    reasoning: "Top coding score (99). Fallback activated: gpt-6-sol timed out",
    latencyMs: 812,
    requestId: "req_123",
    sandbox: true,
    fallback: true,
  });
  const empty = routingFromHeaders(new Headers());
  assert.equal(empty.model, null);
  assert.equal(empty.latencyMs, null);
  assert.equal(empty.sandbox, false);
});

test("router errors point at the page that fixes them", () => {
  const h = new Headers({ "x-aism-request-id": "req_9" });
  const e401 = routerErrorFor(401, { error: { message: "Invalid API key" } }, h);
  assert.equal(e401.helpUrl, ROUTER_KEYS_URL);
  assert.equal(e401.requestId, "req_9");

  const noKeys = routerErrorFor(
    400,
    { error: { code: "no_provider_keys", message: "No provider keys configured" } },
    h,
  );
  assert.equal(noKeys.helpUrl, PROVIDER_KEYS_URL);
  assert.equal(noKeys.message, "No provider keys configured");

  const allowance = routerErrorFor(429, { error: { code: "allowance_exhausted" } }, h);
  assert.equal(allowance.helpUrl, PRICING_URL);

  const limited = routerErrorFor(429, null, new Headers({ "retry-after": "7" }));
  assert.match(limited.message, /7 s/);

  const down = routerErrorFor(503, "not json", h);
  assert.match(down.message, /HTTP 503/);
});

// ── SSE ─────────────────────────────────────────────────────────────────────

test("SSE payloads split across chunk boundaries, LF and CRLF, until [DONE]", async () => {
  const stream = from([
    'data: {"a":1}\n',
    '\ndata: {"b"',
    ':2}\r\n\r\n: comment\n\ndata: [DONE]\n\ndata: {"after":true}\n\n',
  ]);
  assert.deepEqual(await collect(sseData(stream)), ['{"a":1}', '{"b":2}']);
});

test("a stream that ends without [DONE] is an error, not a silent cut", async () => {
  await assert.rejects(collect(sseData(from(['data: {"a":1}\n\n']))), (e: unknown) => {
    assert.ok(e instanceof RouterError);
    assert.equal(e.code, "stream_interrupted");
    return true;
  });
});

test("an error chunk mid-stream is thrown; deltas carry text and reasoning", async () => {
  const payloads = [
    JSON.stringify(chunk({ reasoning_content: "Let me think" })),
    JSON.stringify(chunk({ content: "Hello" })),
    "not json",
    JSON.stringify(chunk({ content: " world" }, "stop")),
  ];
  const deltas = await collect(chatDeltas(parseChunks(from(payloads), "req_1")));
  assert.deepEqual(deltas, [{ reasoning: "Let me think" }, { content: "Hello" }, { content: " world" }]);

  const broken = [JSON.stringify(chunk({ content: "Hel" })), JSON.stringify({ error: { message: "upstream reset" } })];
  await assert.rejects(collect(parseChunks(from(broken), "req_2")), (e: unknown) => {
    assert.ok(e instanceof RouterError);
    assert.equal(e.message, "upstream reset");
    assert.equal(e.requestId, "req_2");
    return true;
  });
});

test("streamChat end to end against a fake router", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const body = [chunk({ role: "assistant", content: "" }), chunk({ content: "Hi" }), chunk({}, "stop")]
    .map((c) => `data: ${JSON.stringify(c)}\n\n`)
    .join("")
    .concat("data: [DONE]\n\n");
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-aism-model": "gpt-6-sol",
        "x-aism-provider": "openai",
        "x-aism-sandbox": "true",
      },
    });
  }) as unknown as typeof fetch;

  const s = await streamChat(
    { model: "auto-best", messages: [{ role: "user", content: "hi" }] },
    { apiKey: "aism_test", sandbox: true, fetchImpl },
  );
  assert.equal(s.routing.model, "gpt-6-sol");
  assert.deepEqual(await collect(s.deltas), [{ content: "Hi" }]);
  assert.ok(seen);
  const { url, init } = seen as { url: string; init: RequestInit };
  assert.equal(url, "https://aistupidlevel.info/v1/chat/completions");
  const headers = init.headers as Record<string, string>;
  assert.equal(headers["X-ASL-Sandbox"], "true");
  assert.equal(headers.Authorization, "Bearer aism_test");
  assert.deepEqual(JSON.parse(String(init.body)), {
    model: "auto-best",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
  });
});

test("missing router key fails before any request", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response("{}");
  }) as unknown as typeof fetch;
  await assert.rejects(previewRoute({ model: "auto", messages: [] }, { apiKey: "", fetchImpl }), (e: unknown) => {
    assert.ok(e instanceof RouterError);
    assert.equal(e.code, "missing_key");
    return true;
  });
  assert.equal(called, false);
});

// ── Raycast AI model provider ───────────────────────────────────────────────

test("Raycast ModelMessages become OpenAI messages, tool turns included", () => {
  const out = toOpenAIMessages({
    system: "Be brief.",
    messages: [
      { role: "user", content: [{ type: "text", text: "Weather in Oslo?" }] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "need the tool" },
          { type: "tool-call", toolCallId: "call_1", toolName: "get_weather", input: { city: "Oslo" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "get_weather",
            output: { type: "json", value: { temp: 7 } },
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "It is 7 °C." }] },
      { role: "user", content: [{ type: "text", text: "Thanks" }] },
    ],
  });
  assert.deepEqual(out, [
    { role: "system", content: "Be brief." },
    { role: "user", content: "Weather in Oslo?" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Oslo"}' } }],
    },
    { role: "tool", tool_call_id: "call_1", content: '{"temp":7}' },
    { role: "assistant", content: "It is 7 °C." },
    { role: "user", content: "Thanks" },
  ]);
});

test("tools become OpenAI function tools", () => {
  assert.equal(toOpenAITools(undefined), undefined);
  assert.equal(toOpenAITools({}), undefined);
  assert.deepEqual(
    toOpenAITools({
      get_weather: {
        description: "Weather",
        inputSchema: { type: "object", properties: { city: { type: "string" } } },
      },
      ping: {},
    }),
    [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      },
      { type: "function", function: { name: "ping", parameters: { type: "object", properties: {} } } },
    ],
  );
});

test("stream parts: text, reasoning, tool calls assembled from fragments, finish with usage", async () => {
  const chunks: ChatChunk[] = [
    chunk({ reasoning_content: "hmm" }),
    chunk({ content: "Checking" }),
    chunk({
      tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"ci' } }],
    }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: 'ty":"Oslo"}' } }] }),
    chunk({}, "tool_calls"),
    { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } },
  ];
  const parts = await collect(toStreamParts(from(chunks)));
  assert.deepEqual(parts, [
    { type: "reasoning-delta", text: "hmm" },
    { type: "text-delta", text: "Checking" },
    { type: "tool-call", toolCallId: "call_1", toolName: "get_weather", input: { city: "Oslo" } },
    { type: "finish", finishReason: "tool-calls", totalUsage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 } },
  ]);

  const plain = await collect(toStreamParts(from([chunk({ content: "ok" }), chunk({}, "length")])));
  assert.deepEqual(plain, [
    { type: "text-delta", text: "ok" },
    { type: "finish", finishReason: "length" },
  ]);
});

// ── Conversation views ──────────────────────────────────────────────────────

test("answer markdown for each state", () => {
  assert.equal(quotePrompt("a\nb"), "> a\n> b");
  assert.match(quotePrompt("x".repeat(700)), /…$/);
  assert.match(answerMarkdown({ prompt: "Hi", answer: "", state: "routing" }), /Choosing a model/);
  assert.match(answerMarkdown({ prompt: "Hi", answer: "", state: "thinking" }), /Thinking/);
  assert.equal(answerMarkdown({ prompt: "Hi", answer: "Hello", state: "done" }), "> Hi\n\nHello");
  assert.match(
    answerMarkdown({ prompt: "Hi", answer: "Hel", state: "error", errorMessage: "upstream reset" }),
    /Hel\n\n\*\*The answer could not be completed\.\*\* upstream reset/,
  );
  assert.deepEqual(withUserTurn([{ role: "user", content: "a" }], "b"), [
    { role: "user", content: "a" },
    { role: "user", content: "b" },
  ]);
  assert.equal(modeLabel("auto-coding"), "Coding");
  assert.equal(modeLabel("gpt-6-sol"), "Pinned: gpt-6-sol");
});

test("route preview markdown", () => {
  const preview: RoutePreview = {
    object: "route.preview",
    requested_model: "auto-coding",
    strategy: "best_coding",
    sandbox: true,
    primary: {
      model: "claude-opus-5-5",
      provider: "anthropic",
      score: 99,
      reasoning: "Top coding score",
      estimated_cost_usd: 0.0042,
    },
    fallbacks: [{ model: "gpt-6-sol", provider: "openai", score: 97, reasoning: "", estimated_cost_usd: null }],
    fallback_enabled: true,
  };
  const md = previewMarkdown(preview, "Fix my loop");
  assert.match(md, /^> Fix my loop/);
  assert.match(md, /## claude-opus-5-5\n\nAnthropic · score 99/);
  assert.match(md, /\$0\.0042/);
  assert.match(md, /1\. `gpt-6-sol` \(OpenAI, score 97\)/);
});
