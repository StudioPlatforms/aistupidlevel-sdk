import { test } from "node:test";
import assert from "node:assert/strict";
import plugin, { buildCatalog, fetchModelIds, modelRow, resolveDynamicModel, baseUrl, ROUTING_MODES, PROVIDER_ID } from "../dist/index.js";

const jsonFetch = (status, body, seen = []) => async (url, init) => {
  seen.push({ url, init });
  return { ok: status >= 200 && status < 300, status, json: async () => body };
};

test("model rows are text-only, free at the router, with pool-wide limits", () => {
  const r = modelRow("auto-coding");
  assert.equal(r.name, "Best for coding (routed)");
  assert.deepEqual(r.input, ["text"]);
  assert.deepEqual(r.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(r.contextWindow, 262144);
  assert.equal(modelRow("claude-opus-5-5").name, "claude-opus-5-5");
});

test("live catalog: authenticated GET /models, routing modes first", async () => {
  const seen = [];
  const ids = await fetchModelIds("aism_x", "https://aistupidlevel.info/v1",
    jsonFetch(200, { data: [{ id: "claude-opus-5-5" }, { id: "auto-coding" }, { id: "auto-tooling" }, { id: "gpt-6-sol" }] }, seen));
  assert.deepEqual(ids, ["auto-tooling", "auto-coding", "claude-opus-5-5", "gpt-6-sol"]);
  assert.equal(seen[0].url, "https://aistupidlevel.info/v1/models");
  assert.equal(seen[0].init.headers.Authorization, "Bearer aism_x");
});

test("an unreachable or empty catalog falls back to the routing modes", async () => {
  assert.equal(await fetchModelIds("k", "u", jsonFetch(401, {})), null);
  assert.equal(await fetchModelIds("k", "u", jsonFetch(200, { data: [] })), null);
  assert.equal(await fetchModelIds("k", "u", async () => { throw new Error("offline"); }), null);
  const cat = await buildCatalog("aism_x", jsonFetch(500, {}));
  assert.deepEqual(cat.provider.models.map((m) => m.id), ROUTING_MODES.map(([id]) => id));
  assert.equal(cat.provider.api, "openai-completions");
  assert.equal(cat.provider.apiKey, "aism_x");
});

test("no key, no catalog", async () => {
  assert.equal(await buildCatalog(undefined), null);
});

test("any model id resolves dynamically against the router", () => {
  const m = resolveDynamicModel({ modelId: "kimi-k3" });
  assert.equal(m.id, "kimi-k3");
  assert.equal(m.provider, PROVIDER_ID);
  assert.equal(m.baseUrl, "https://aistupidlevel.info/v1");
});

test("ASL_BASE_URL overrides the endpoint", () => {
  assert.equal(baseUrl({ ASL_BASE_URL: "http://127.0.0.1:9000/v1/" }), "http://127.0.0.1:9000/v1");
  assert.equal(baseUrl({}), "https://aistupidlevel.info/v1");
});

test("register() declares one provider with API-key auth, a catalog and dynamic models", () => {
  const providers = [];
  const api = new Proxy({ registerProvider: (p) => providers.push(p) }, { get: (t, k) => t[k] ?? (() => {}) });
  plugin.register(api);
  assert.equal(providers.length, 1);
  const p = providers[0];
  assert.equal(p.id, "aistupidlevel");
  assert.deepEqual(p.envVars, ["ASL_ROUTER_KEY"]);
  assert.equal(p.auth.length, 1);
  assert.equal(typeof p.catalog.run, "function");
  assert.equal(typeof p.resolveDynamicModel, "function");
});
