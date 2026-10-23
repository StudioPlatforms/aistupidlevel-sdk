import assert from "node:assert/strict";
import { test } from "node:test";
import { type AssistantMessage, createModels, type RefreshModelsContext, Type } from "@earendil-works/pi-ai";
import extension, {
  API_KEY_ENV_VARS,
  answeredBy,
  createAistupidlevelProvider,
  DEFAULT_BASE_URL,
  FALLBACK_MODES,
  fetchModelIds,
  modelRow,
  PROVIDER_ID,
  ROUTING_MODES,
  routerKeyAuth,
  STATUS_KEY,
} from "../index.ts";

type Seen = { url: string; init?: RequestInit };

const jsonFetch = (status: number, body: unknown, seen: Seen[] = []): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

const liveList = { data: [{ id: "claude-opus-5-5" }, { id: "auto" }, { id: "auto-split" }, { id: "auto-coding" }, { id: "gpt-6-sol" }, { id: "auto-tooling" }] };

/** A refresh context like the one Pi passes, recording what the provider publishes. */
function refreshContext(overrides: Partial<RefreshModelsContext> = {}): RefreshModelsContext {
  return {
    credential: { type: "api_key", key: "aism_test" },
    allowNetwork: true,
    signal: new AbortController().signal,
    publish: async (publication) => {
      publication.update?.();
      return true;
    },
    ...overrides,
  };
}

test("model rows are text-only, zero-cost (BYOK) and carry the pool-wide limits", () => {
  const row = modelRow("auto-coding");
  assert.equal(row.name, "Best for coding (routed)");
  assert.equal(row.provider, PROVIDER_ID);
  assert.equal(row.api, "openai-completions");
  assert.equal(row.baseUrl, DEFAULT_BASE_URL);
  assert.deepEqual(row.input, ["text"]);
  assert.deepEqual(row.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(row.contextWindow, 262144);
  assert.equal(row.maxTokens, 64000);
  assert.equal(row.reasoning, false);
  assert.equal(modelRow("claude-opus-5-5").name, "claude-opus-5-5");
});

test("before any refresh the catalog is the main routing modes, auto-coding first", () => {
  const provider = createAistupidlevelProvider();
  const ids = provider.getModels().map((m) => m.id);
  assert.deepEqual(ids, [...FALLBACK_MODES]);
  assert.equal(ids[0], "auto-coding");
  assert.ok(ids.includes("auto-tooling") && ids.includes("auto-reasoning") && ids.includes("auto"));
});

test("live catalog: authenticated GET /models, routing modes first, then pinnable models", async () => {
  const seen: Seen[] = [];
  const ids = await fetchModelIds("aism_x", DEFAULT_BASE_URL, undefined, jsonFetch(200, liveList, seen));
  assert.deepEqual(ids, ["auto-coding", "auto-tooling", "auto", "auto-split", "claude-opus-5-5", "gpt-6-sol"]);
  assert.equal(seen[0].url, "https://aistupidlevel.info/v1/models");
  assert.equal((seen[0].init?.headers as Record<string, string>).Authorization, "Bearer aism_x");
});

test("an unreadable catalog throws, so Pi keeps the list it has", async () => {
  await assert.rejects(fetchModelIds("k", "u", undefined, jsonFetch(401, {})), /HTTP 401/);
  await assert.rejects(fetchModelIds("k", "u", undefined, jsonFetch(200, { data: [] })), /no models/);
  await assert.rejects(fetchModelIds("k", "u", undefined, (async () => { throw new Error("offline"); }) as typeof fetch), /offline/);
});

test("a refresh installs the live list; a failed one leaves the routing modes", async () => {
  const seen: Seen[] = [];
  const provider = createAistupidlevelProvider({ fetch: jsonFetch(200, liveList, seen) });
  await provider.refreshModels?.(refreshContext());
  const models = provider.getModels();
  assert.equal(models[0].id, "auto-coding");
  assert.deepEqual(models.map((m) => m.id).slice(FALLBACK_MODES.length), ["auto-split", "claude-opus-5-5", "gpt-6-sol"]);
  assert.equal(seen[0].url, "https://aistupidlevel.info/v1/models");

  const offline = createAistupidlevelProvider({ fetch: jsonFetch(503, {}) });
  await assert.rejects(offline.refreshModels!(refreshContext()), /HTTP 503/);
  assert.deepEqual(offline.getModels().map((m) => m.id), [...FALLBACK_MODES]);
});

test("key: /login wins, then AISTUPIDLEVEL_API_KEY, then ASL_ROUTER_KEY", async () => {
  assert.deepEqual([...API_KEY_ENV_VARS], ["AISTUPIDLEVEL_API_KEY", "ASL_ROUTER_KEY"]);
  const auth = routerKeyAuth();
  const signal = new AbortController().signal;
  const ctx = (env: Record<string, string>) => ({ env: async (name: string) => env[name], fileExists: async () => false });
  const both = ctx({ AISTUPIDLEVEL_API_KEY: "aism_primary", ASL_ROUTER_KEY: "aism_fallback" });
  assert.equal((await auth.resolve({ ctx: both, signal }))?.auth.apiKey, "aism_primary");
  assert.equal((await auth.resolve({ ctx: ctx({ ASL_ROUTER_KEY: "aism_fallback" }), signal }))?.auth.apiKey, "aism_fallback");
  assert.equal((await auth.resolve({ ctx: both, credential: { type: "api_key", key: "aism_stored" }, signal }))?.auth.apiKey, "aism_stored");
  assert.equal(await auth.resolve({ ctx: ctx({}), signal }), undefined);
});

test("/login asks for the router key and says where to create one", async () => {
  const prompts: Array<{ message: string; placeholder?: string }> = [];
  const interaction = (answer: string) => ({
    signal: new AbortController().signal,
    prompt: async (p: { message: string; placeholder?: string }) => {
      prompts.push(p);
      return answer;
    },
    notify: () => {},
  });
  const auth = routerKeyAuth();
  assert.deepEqual(await auth.login!(interaction("  aism_pasted \n")), { type: "api_key", key: "aism_pasted" });
  assert.match(prompts[0].message, /aistupidlevel\.info\/router\/keys/);
  await assert.rejects(auth.login!(interaction("   ")), /No router key/);
});

test("an endpoint set in models.json is where the list is read; entries keep the public router", async () => {
  // Pi passes the provider's composed endpoint (a models.json baseUrl wins) and applies the same
  // override to every entry when it reads them, so the entries Pi keeps between runs never go stale.
  const seen: Seen[] = [];
  const provider = createAistupidlevelProvider({ fetch: jsonFetch(200, liveList, seen) });
  await provider.refreshModels?.(refreshContext({ baseUrl: "http://127.0.0.1:9/v1/" }));
  assert.equal(seen[0].url, "http://127.0.0.1:9/v1/models");
  assert.ok(provider.getModels().every((m) => m.baseUrl === DEFAULT_BASE_URL));
});

test("the answering model comes from X-AISM-Model, in any case", () => {
  assert.equal(answeredBy({ "x-aism-model": "claude-sonnet-5-5" }), "claude-sonnet-5-5");
  assert.equal(answeredBy({ "X-AISM-Model": "gpt-6-sol" }), "gpt-6-sol");
  assert.equal(answeredBy({ "content-type": "text/event-stream" }), undefined);
  assert.equal(answeredBy(undefined), undefined);
});

test("the extension registers the provider and shows the answering model in the footer", () => {
  const providers: unknown[] = [];
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const pi = { registerProvider: (p: unknown) => providers.push(p), on: (name: string, h: any) => handlers.set(name, h) };
  extension(pi as any);
  assert.equal(providers.length, 1);
  assert.equal((providers[0] as { id: string }).id, PROVIDER_ID);

  const statuses: Array<[string, string | undefined]> = [];
  const ctx = { hasUI: true, ui: { setStatus: (key: string, text: string | undefined) => statuses.push([key, text]) } };
  const response = (headers: Record<string, string>, on = ctx) =>
    handlers.get("after_provider_response")!({ type: "after_provider_response", status: 200, headers }, on);
  response({ "x-aism-model": "gpt-6-sol" });
  response({ "x-aism-model": "gpt-6-sol" }); // unchanged: the footer is not repainted
  response({});
  handlers.get("model_select")!({ type: "model_select", model: { provider: PROVIDER_ID, id: "auto-tooling" } }, ctx);
  handlers.get("model_select")!({ type: "model_select", model: { provider: "anthropic", id: "claude-opus-5-5" } }, ctx);
  response({ "x-aism-model": "claude-sonnet-5-5" });
  assert.deepEqual(statuses, [[STATUS_KEY, "ASL → gpt-6-sol"], [STATUS_KEY, undefined], [STATUS_KEY, "ASL → claude-sonnet-5-5"]]);

  // Print mode has no UI, and a replaced session's context throws: neither breaks the request.
  response({ "x-aism-model": "m1" }, { hasUI: false, ui: { setStatus: () => assert.fail() } } as any);
  response({ "x-aism-model": "m2" }, { get hasUI(): boolean { throw new Error("stale context"); } } as any);
});

test("every routing mode has a display name", () => {
  for (const [id, name] of ROUTING_MODES) {
    assert.match(id, /^auto(-[a-z]+)*$/);
    assert.match(name, /\(routed\)$/);
  }
});

// Live: the real router in sandbox mode (real routing, mock answers, nothing spent). Needs a router key.
const liveKey = process.env.AISTUPIDLEVEL_API_KEY || process.env.ASL_ROUTER_KEY;
const live = { skip: liveKey ? false : "set ASL_ROUTER_KEY=aism_... to run the live sandbox tests" };

test("live: GET /v1/models lists the routing modes", live, async () => {
  const ids = await fetchModelIds(liveKey!, DEFAULT_BASE_URL);
  assert.equal(ids[0], "auto-coding");
  for (const id of FALLBACK_MODES) assert.ok(ids.includes(id), `${id} is listed`);
});

test("live: a sandboxed request and a tool turn through Pi's OpenAI implementation", live, async () => {
  const models = createModels();
  models.setProvider(createAistupidlevelProvider());
  const model = models.getModel(PROVIDER_ID, "auto-coding")!;
  let header: string | undefined;
  const options = {
    headers: { "X-ASL-Sandbox": "true" },
    onResponse: (response: { headers: Record<string, string> }) => {
      header = answeredBy(response.headers);
    },
  };

  const answer = await models.completeSimple(model, {
    systemPrompt: "You are a coding agent.",
    messages: [{ role: "user", content: "Say hi", timestamp: Date.now() }],
  }, options);
  assert.equal(answer.stopReason, "stop", answer.errorMessage);
  assert.ok(header, "X-AISM-Model is present");
  assert.equal(answer.responseModel, header);
  assert.match(answer.content.map((c) => (c.type === "text" ? c.text : "")).join(""), /Sandbox response/);

  const tools = [{ name: "read", description: "Read a file", parameters: Type.Object({ path: Type.String() }) }];
  const user = { role: "user" as const, content: "Read the file named sandbox", timestamp: Date.now() };
  const call: AssistantMessage = await models.completeSimple(model, { messages: [user], tools }, options);
  assert.equal(call.stopReason, "toolUse", call.errorMessage);
  const toolCall = call.content.find((c) => c.type === "toolCall");
  assert.ok(toolCall && toolCall.type === "toolCall");
  assert.equal(toolCall.name, "read");
  assert.deepEqual(toolCall.arguments, { path: "sandbox" });

  const result = { role: "toolResult" as const, toolCallId: toolCall.id, toolName: "read", content: [{ type: "text" as const, text: "file contents" }], isError: false, timestamp: Date.now() };
  const final = await models.completeSimple(model, { messages: [user, call, result], tools }, options);
  assert.equal(final.stopReason, "stop", final.errorMessage);
  assert.match(final.content.map((c) => (c.type === "text" ? c.text : "")).join(""), /file contents/);
});
