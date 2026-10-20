// Offline tests: the server runs in-process, an MCP client talks to it over an in-memory transport,
// and fetch is mocked with real Data API and Smart Router responses captured on 2026-10-20.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/index.js';

const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const load = (p) => JSON.parse(readFileSync(dir + p, 'utf8'));
const DATA_META = load('responses.json');
const ROUTER_META = load('router/responses.json');
const DATA = 'https://data.test/api/v1';
const ROUTER = 'https://router.test/v1';
const DATA_KEY = 'asl_live_unit_test_secret';
const ROUTER_KEY = 'aism_unit_test_secret';

const respond = (body, status = 200, headers = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
// The captured quota resets at a fixed instant; keep it in the future so the tests do not age.
const nextMidnight = () => { const d = new Date(); return String(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000); };
const fresh = (h) => (h['x-ratelimit-reset'] ? { ...h, 'x-ratelimit-reset': nextMidnight() } : h);
const dataFixture = (name) => respond(load(`${name}.json`), DATA_META[name].status, fresh(DATA_META[name].headers));
const routerFixture = (name) => respond(load(`router/${name}.json`), ROUTER_META[name].status, ROUTER_META[name].headers);

/** The Data API and Smart Router, served from fixtures. `override(url, init)` may answer first. */
function mockFetch(override) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: String(url), path: u.pathname, query: Object.fromEntries(u.searchParams), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    const custom = override && (await override(u, init, calls.length));
    if (custom) return custom;
    if (String(url).startsWith(DATA)) {
      const p = u.pathname.slice('/api/v1'.length);
      if (u.searchParams.get('period') === 'latest') return dataFixture('latest_refused');
      const map = {
        '/me': 'me', '/models': 'models', '/models/292': 'model', '/models/292/history': 'history', '/index': 'index',
        '/incidents': 'incidents', '/providers': 'providers', '/analytics/recommendations': 'recommendations', '/drift/292': 'drift',
      };
      if (map[p]) return dataFixture(map[p]);
      if (/^\/models\/\d+$/.test(p)) return respond({ error: 'model_not_found', model: p.split('/')[2] }, 404);
      return respond({ error: 'not_found' }, 404);
    }
    if (String(url).startsWith(ROUTER)) {
      const p = u.pathname.slice('/v1'.length);
      if (p === '/route/preview') return routerFixture('preview');
      if (p === '/chat/completions') return routerFixture('chat');
      if (p === '/usage') return routerFixture('usage');
    }
    throw new Error(`unexpected request ${url}`);
  };
  fn.calls = calls;
  return fn;
}

async function connect(opts = {}) {
  const fetch = opts.fetch ?? mockFetch();
  const logs = [];
  const server = createServer({
    dataKey: DATA_KEY, routerKey: ROUTER_KEY, dataBaseURL: DATA, routerBaseURL: ROUTER, env: {}, fetch, log: (m) => logs.push(m), ...opts, ...(opts.fetch ? {} : { fetch }),
  });
  const client = new Client({ name: 'unit-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError };
  };
  return { client, call, fetch, logs, close: () => client.close() };
}

const DATA_TOOLS = ['get_leaderboard', 'get_model', 'get_model_history', 'get_drift_status', 'get_incidents', 'get_provider_status', 'get_recommendations', 'get_global_index'];
const ROUTER_TOOLS = ['preview_route', 'ask_router'];

test('lists every tool with a description, an input schema and annotations; and the prompt', async () => {
  const c = await connect();
  const { tools } = await c.client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...DATA_TOOLS, ...ROUTER_TOOLS, 'get_usage'].sort());
  for (const t of tools) {
    assert.ok(t.description && t.description.length > 60, `${t.name} has a useful description`);
    assert.equal(t.inputSchema.type, 'object');
    assert.ok(t.annotations, `${t.name} has annotations`);
  }
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const n of [...DATA_TOOLS, 'preview_route', 'get_usage']) assert.equal(byName[n].annotations.readOnlyHint, true, n);
  assert.equal(byName.ask_router.annotations.readOnlyHint, false);
  assert.deepEqual(byName.get_model.inputSchema.required, ['model']);
  assert.ok(byName.ask_router.inputSchema.properties.mode.enum.includes('auto-value-coding'));
  const { prompts } = await c.client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name), ['choose_model']);
  const p = await c.client.getPrompt({ name: 'choose_model', arguments: { task: 'refactoring TypeScript' } });
  assert.match(p.messages[0].content.text, /refactoring TypeScript/);
  const info = c.client.getServerVersion();
  assert.equal(info.name, 'aistupidlevel');
  assert.match(c.client.getInstructions(), /10 requests a day/);
  assert.equal(c.fetch.calls.length, 0, 'listing makes no request');
  await c.close();
});

test('get_leaderboard: ranks, joint ranks, attribution, quota, and the key in the Authorization header', async () => {
  const c = await connect();
  const r = await c.call('get_leaderboard', {});
  assert.equal(r.isError, false);
  assert.match(r.text, /combined score, 24-hour view\. 24 models tracked/);
  assert.match(r.text, /^=1\. Claude Opus 5\.5 \(claude-opus-5-5, id 292\) · anthropic · score 95 · trend stable · status excellent/m);
  assert.match(r.text, /^=1\. GPT-5\.6 Luna \(gpt-5\.6-luna, id 277\)/m, 'equal scores share a rank');
  assert.match(r.text, /^=3\. DeepSeek/m);
  assert.match(r.text, /^8\. /m, 'a unique score keeps its position');
  assert.match(r.text, /Attribution required: cite aistupidlevel\.info/);
  assert.match(r.text, /requests left today for this key: 8 of 10/);
  assert.equal(r.text.split('\n').filter((l) => /^=?\d+\. /.test(l)).length, 10, 'default limit 10');
  const q = c.fetch.calls[0];
  assert.equal(q.path, '/api/v1/models');
  assert.deepEqual(q.query, {}, 'no period or sortBy unless asked: the API picks the key\'s default');
  assert.equal(q.headers.Authorization, `Bearer ${DATA_KEY}`);
  assert.match(q.headers['User-Agent'], /^aistupidlevel-mcp\//);
  await c.close();
});

test('caching: repeats, filters and name lookups reuse one request; concurrent calls share it', async () => {
  const c = await connect();
  await Promise.all([c.call('get_leaderboard', {}), c.call('get_leaderboard', { vendor: 'openai', limit: 3 })]);
  assert.equal(c.fetch.calls.length, 1, 'two concurrent calls, one request');
  const again = await c.call('get_leaderboard', { vendor: 'openai', limit: 3 });
  assert.match(again.text, /Served from this server's cache/);
  assert.equal(again.text.split('\n').filter((l) => /^=?\d+\. /.test(l)).length, 3);
  assert.ok(!/anthropic ·/.test(again.text));
  const m = await c.call('get_model', { model: 'Claude Opus 5.5' });
  assert.equal(m.isError, false, m.text);
  assert.deepEqual(c.fetch.calls.map((x) => x.path), ['/api/v1/models', '/api/v1/models/292'], 'the name resolved from the cached leaderboard');
  assert.match(m.text, /Leaderboard \(24-hour view\): score 95/);
  await c.call('get_model', { model: '292' });
  assert.equal(c.fetch.calls.length, 2);
  // A different query is a different request.
  await c.call('get_leaderboard', { sort_by: 'coding', period: '7d' });
  assert.deepEqual(c.fetch.calls[2].query, { period: '7d', sortBy: 'coding' });
  await c.close();
});

test('the cache expires after its TTL', async () => {
  const c = await connect({ cacheTtlSeconds: 0 });
  await c.call('get_provider_status');
  await c.call('get_provider_status');
  assert.equal(c.fetch.calls.length, 2);
  await c.close();
});

test('a model given by name is looked up with one /models request when nothing is cached', async () => {
  const c = await connect();
  const r = await c.call('get_drift_status', { model: 'claude-opus-5-5' });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(c.fetch.calls.map((x) => x.path), ['/api/v1/models', '/api/v1/drift/292']);
  assert.match(r.text, /Drift status for Claude Opus 5\.5 \(claude-opus-5-5, id 292\): NORMAL, regime STABLE/);
  assert.match(r.text, /Current score 99 \(95% CI 98-99\), baseline 97, on the coding suite/);
  assert.match(r.text, /- tool use: no shift detected; statistic 0\.005 vs threshold 0\.50, 26 days/);
  assert.match(r.text, /- recovery: 86%, up \(\+7\)/);
  const ambiguous = await c.call('get_model', { model: 'claude' });
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.text, /matches more than one model/);
  const unknown = await c.call('get_model', { model: 'no-such-model' });
  assert.equal(unknown.isError, true);
  assert.match(unknown.text, /No tracked model matches "no-such-model"\. Tracked models: .*claude-opus-5-5 \(id 292\)/);
  assert.equal(c.fetch.calls.length, 2, 'failed lookups cost nothing');
  const missing = await c.call('get_model', { model: '999999' });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /does not track a model with that id/);
  await c.close();
});

test('every data tool renders its fixture', async () => {
  const c = await connect();
  const h = await c.call('get_model_history', { model: '292', max_points: 3 });
  assert.match(h.text, /Score history for 292|Score history for .*id 292/);
  assert.match(h.text, /6 runs from .* to 2026-10-20 06:00 UTC/);
  assert.match(h.text, /Newest run by axis: correctness 97%, spec compliance 99%, code quality 95%/);
  assert.match(h.text, /… 3 older runs not listed/);
  const m = await c.call('get_model', { model: '292' });
  assert.match(m.text, /vendor anthropic · version 2026-09-21 · tracked for 27 days/);
  assert.match(m.text, /Tool calling: supported \(up to 10 tools per call\)/);
  assert.match(m.text, /Newest-run score: needs a paid Data API key/);
  const i = await c.call('get_incidents', {});
  assert.match(i.text, /#939 \[major\] PROVIDER INCIDENT: OPENAI — 5\/8 models affected/);
  assert.match(i.text, /resolved 2026-10-17 16:43 UTC \(after 3 days\)/);
  assert.match(i.text, /Affected models: gpt-5\.6-sol/);
  assert.deepEqual(c.fetch.calls.at(-1).query, { limit: '50' });
  const open = await c.call('get_incidents', { open_only: true });
  assert.match(open.text, /No open incidents/);
  const anth = await c.call('get_incidents', { provider: 'Anthropic', limit: 1 });
  assert.match(anth.text, /#938/);
  assert.ok(!/#939/.test(anth.text));
  const p = await c.call('get_provider_status');
  assert.match(p.text, /- anthropic: operational · probe answered in 1392 ms · checked 2026-10-20 06:20 UTC/);
  const rec = await c.call('get_recommendations', {});
  assert.match(rec.text, /Best for coding: Claude Opus 5\.5 \(claude-opus-5-5, id 292\) · anthropic · leaderboard score 95/);
  assert.match(rec.text, /Evidence: Most points per measured dollar/);
  assert.match(rec.text, /Fastest response: none in this view/);
  assert.match(rec.text, /Avoid right now: none/);
  const g = await c.call('get_global_index');
  assert.match(g.text, /global index: 87 now across 24 models, trend declining/);
  assert.match(g.text, /6h ago 91/);
  for (const x of [h, m, i, p, rec, g]) assert.equal(x.isError, false);
  await c.close();
});

test('period=latest on a free key: a clear refusal with the pricing link, cached so it costs one request', async () => {
  const c = await connect();
  const r = await c.call('get_leaderboard', { period: 'latest' });
  assert.equal(r.isError, true);
  assert.match(r.text, /paid plans.*use period=24h, 7d or 1m.*https:\/\/aistupidlevel\.info\/pricing/);
  await c.call('get_leaderboard', { period: 'latest' });
  assert.equal(c.fetch.calls.length, 1);
  await c.close();
});

test('daily quota used up (real 429): clear error, then no more requests until the reset', async () => {
  const fetch = mockFetch(() => respond(load('quota_exceeded.json'), 429, fresh(DATA_META.quota_exceeded.headers)));
  const c = await connect({ fetch });
  const r = await c.call('get_leaderboard', {});
  assert.equal(r.isError, true);
  assert.match(r.text, /daily limit for this key is used up\. You have used 11 of 10 requests on the Free tier today/);
  assert.match(r.text, /10 requests a day and 1 a minute.*https:\/\/aistupidlevel\.info\/pricing/);
  const other = await c.call('get_provider_status');
  assert.equal(other.isError, true);
  assert.match(other.text, /daily limit/);
  assert.equal(fetch.calls.length, 1, 'blocked locally until the quota resets');
  await c.close();
});

test('when a fresh answer cannot be fetched, the older cached one is served with a note', async () => {
  let fail = false;
  const fetch = mockFetch(() => (fail ? respond(load('quota_exceeded.json'), 429, fresh(DATA_META.quota_exceeded.headers)) : null));
  const c = await connect({ fetch, cacheTtlSeconds: 0 });
  await c.call('get_global_index');
  fail = true;
  const r = await c.call('get_global_index');
  assert.equal(r.isError, false);
  assert.match(r.text, /global index: 87/);
  assert.match(r.text, /NOTE: this is an older cached answer, fetched \d+ s ago.*daily limit/);
  await c.close();
});

test('per-minute 429: waits and retries once when Retry-After is short', async () => {
  // Body and headers as the API's rate limiter sends them (src/index.ts errorResponseBuilder).
  // @fastify/rate-limit sends its own per-minute x-ratelimit-* values (reset in seconds, not an epoch).
  const limited = () => respond({ statusCode: 429, error: 'Too Many Requests', message: 'You are making requests too quickly. Please wait 1s and try again.' }, 429, { 'retry-after': '1', 'x-ratelimit-limit': '1', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' });
  const fetch = mockFetch((u, init, n) => (n === 1 ? limited() : null));
  const c = await connect({ fetch, maxWaitSeconds: 2 });
  const t0 = Date.now();
  const r = await c.call('get_provider_status');
  assert.equal(r.isError, false, r.text);
  assert.ok(Date.now() - t0 >= 950, 'waited for Retry-After');
  assert.equal(fetch.calls.length, 2);
  assert.match(r.text, /requests left today for this key: 3 of 10/, 'the per-minute headers are not taken for the daily quota');
  await c.close();
});

test('per-minute 429 with a long Retry-After: error says when to retry and states the free limits', async () => {
  const fetch = mockFetch(() => respond({ statusCode: 429, error: 'Too Many Requests', message: 'You are making requests too quickly. Please wait 42s and try again.' }, 429, { 'retry-after': '42', 'x-ratelimit-limit': '1', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '42' }));
  const c = await connect({ fetch, maxWaitSeconds: 0 });
  const r = await c.call('get_recommendations', {});
  assert.equal(r.isError, true);
  assert.match(r.text, /per-minute limit was reached; try again in 42 s/);
  assert.ok(!/daily limit/.test(r.text));
  await c.call('get_recommendations', {});
  assert.equal(fetch.calls.length, 2, 'not blocked for the day: the next call tries again');
  assert.match(r.text, /1 request a minute and 10 a day/);
  assert.match(r.text, /https:\/\/aistupidlevel\.info\/pricing/);
  await c.close();
});

test('an invalid data key: a clear error that never echoes the key', async () => {
  const fetch = mockFetch(() => respond({ error: 'invalid_api_key', message: 'That API key is not valid, or it has been revoked.' }, 401));
  const c = await connect({ fetch });
  const r = await c.call('get_global_index');
  assert.equal(r.isError, true);
  assert.match(r.text, /rejected the key in ASL_DATA_KEY \(invalid_api_key: That API key is not valid/);
  assert.match(r.text, /account\/data-keys/);
  assert.ok(!r.text.includes(DATA_KEY));
  await c.close();
});

test('missing keys: every tool explains which key it needs and where to get it, without a request', async () => {
  const fetch = mockFetch();
  const c = await connect({ dataKey: undefined, routerKey: undefined, fetch });
  for (const name of DATA_TOOLS) {
    const r = await c.call(name, name.includes('model') || name.includes('drift') ? { model: '292' } : {});
    assert.equal(r.isError, true, name);
    assert.match(r.text, /needs a Data API key \(asl_live_…\).*https:\/\/aistupidlevel\.info\/account\/data-keys.*ASL_DATA_KEY/, name);
  }
  for (const name of ROUTER_TOOLS) {
    const r = await c.call(name, { prompt: 'hi' });
    assert.equal(r.isError, true, name);
    assert.match(r.text, /needs a router key \(aism_…\).*https:\/\/aistupidlevel\.info\/router\/keys.*ASL_ROUTER_KEY/, name);
  }
  const u = await c.call('get_usage');
  assert.equal(u.isError, true);
  assert.match(u.text, /ASL_DATA_KEY.*ASL_ROUTER_KEY/);
  assert.equal(fetch.calls.length, 0);
  await c.close();
});

test('keys from the environment, including a swapped pair and ASL_API_KEY by prefix', async () => {
  const fetch = mockFetch();
  const c = await connect({ dataKey: undefined, routerKey: undefined, fetch, env: { ASL_DATA_KEY: 'aism_wrong_place' } });
  const d = await c.call('get_global_index');
  assert.equal(d.isError, true);
  assert.match(d.text, /ASL_DATA_KEY holds a Smart Router key/);
  const p = await c.call('preview_route', { prompt: 'hi', sandbox: true });
  assert.equal(p.isError, false, 'the router key was moved to where it belongs');
  assert.equal(fetch.calls[0].headers.Authorization, 'Bearer aism_wrong_place');
  assert.ok(c.logs.some((l) => /holds a Smart Router key/.test(l)));
  assert.ok(!c.logs.join('\n').includes('aism_wrong_place'), 'keys are never logged');
  await c.close();
  const c2 = await connect({ dataKey: undefined, routerKey: undefined, fetch: mockFetch(), env: { ASL_API_KEY: DATA_KEY } });
  assert.equal((await c2.call('get_global_index')).isError, false);
  assert.equal((await c2.call('preview_route', { prompt: 'hi' })).isError, true);
  await c2.close();
});

test('preview_route: sandbox header, body, primary and fallbacks', async () => {
  const c = await connect();
  const r = await c.call('preview_route', { prompt: 'Write a function that reverses a string.', mode: 'auto-coding', sandbox: true });
  assert.equal(r.isError, false, r.text);
  const q = c.fetch.calls[0];
  assert.equal(q.path, '/v1/route/preview');
  assert.equal(q.headers['X-ASL-Sandbox'], 'true');
  assert.equal(q.headers.Authorization, `Bearer ${ROUTER_KEY}`);
  assert.deepEqual(q.body, { model: 'auto-coding', messages: [{ role: 'user', content: 'Write a function that reverses a string.' }] });
  assert.match(r.text, /decision for auto-coding \(strategy best_coding\), sandbox/);
  assert.match(r.text, /Primary: claude-opus-5-5 \(anthropic\), score 99, estimated cost \$0\.012\. Why: Selected claude-opus-5-5/);
  assert.match(r.text, /1\. deepseek-v4-flash \(deepseek\), score 97, estimated cost \$0\.00075/);
  assert.match(r.text, /Nothing was sent to a model/);
  const pinned = await c.call('preview_route', { prompt: 'x', system: 'Be brief.', pin_model: 'gpt-6-sol' });
  assert.equal(c.fetch.calls[1].body.model, 'gpt-6-sol');
  assert.equal(c.fetch.calls[1].body.messages[0].role, 'system');
  assert.equal(c.fetch.calls[1].headers['X-ASL-Sandbox'], undefined, 'no sandbox unless asked');
  assert.equal(pinned.isError, false);
  await c.close();
});

test('ask_router: the answer plus which model answered and why, with an idempotency key', async () => {
  const c = await connect();
  const r = await c.call('ask_router', { prompt: 'Write a function that reverses a string.', mode: 'auto-coding', sandbox: true, max_tokens: 500, reasoning_effort: 'low' });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /^Sandbox response from claude-opus-5-5/);
  assert.match(r.text, /Answered by claude-opus-5-5 \(anthropic\) via the AI Stupid Level Smart Router, mode auto-coding/);
  assert.match(r.text, /Why this model: Sandbox: Selected claude-opus-5-5/);
  assert.match(r.text, /latency 2 ms · tokens 10 in \/ 38 out · request id chatcmpl-/);
  assert.match(r.text, /mock answer from real routing/);
  const q = c.fetch.calls[0];
  assert.equal(q.headers['X-ASL-Sandbox'], 'true');
  assert.match(q.headers['Idempotency-Key'], /^asl-mcp-/);
  assert.equal(q.body.max_completion_tokens, 500);
  assert.equal(q.body.reasoning_effort, 'low');
  await c.close();
});

test('ASL_SANDBOX forces sandbox on every router call', async () => {
  const c = await connect({ env: { ASL_SANDBOX: 'true' } });
  await c.call('ask_router', { prompt: 'hi' });
  assert.equal(c.fetch.calls[0].headers['X-ASL-Sandbox'], 'true');
  await c.close();
});

test('router errors are explained and not retried; a 5xx is retried once with the same idempotency key', async () => {
  const exhausted = mockFetch(() => routerFixture('allowance_exhausted'));
  const c = await connect({ fetch: exhausted });
  const r = await c.call('ask_router', { prompt: 'hi', sandbox: true });
  assert.equal(r.isError, true);
  assert.match(r.text, /monthly allowance is used up.*https:\/\/aistupidlevel\.info\/account\/billing/);
  assert.equal(exhausted.calls.length, 1);
  await c.close();

  const bad = await connect({ fetch: mockFetch(() => routerFixture('invalid_key')) });
  const b = await bad.call('preview_route', { prompt: 'hi', sandbox: true });
  assert.match(b.text, /rejected the key in ASL_ROUTER_KEY \(Invalid API key/);
  assert.ok(!b.text.includes(ROUTER_KEY));
  await bad.close();

  const flaky = mockFetch((u, init, n) => (n === 1 ? respond({ error: { message: 'boom', code: 'internal_error' } }, 503) : null));
  const f = await connect({ fetch: flaky });
  const ok = await f.call('ask_router', { prompt: 'hi', sandbox: true });
  assert.equal(ok.isError, false, ok.text);
  assert.equal(flaky.calls.length, 2);
  assert.equal(flaky.calls[0].headers['Idempotency-Key'], flaky.calls[1].headers['Idempotency-Key']);
  await f.close();
});

test('get_usage: router usage and the data quota (one /me request when no quota is known yet)', async () => {
  const c = await connect();
  const r = await c.call('get_usage');
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Smart Router \(2026-10, plan free\): 64 of 1000 requests used, 936 left/);
  assert.match(r.text, /Key test key \(aism_xxxxxxx…\): spent \$0\.00 this month, no budget set/);
  assert.match(r.text, /Data API, free tier \(10 a day, 1 a minute\): 9 of 10 requests left today/);
  assert.deepEqual(c.fetch.calls.map((x) => x.path), ['/v1/usage', '/api/v1/me']);
  await c.call('get_global_index');
  await c.call('get_usage');
  assert.equal(c.fetch.calls.filter((x) => x.path === '/api/v1/me').length, 1, 'later the quota comes from response headers');
  await c.close();
});

test('stdio: the CLI speaks clean JSON-RPC on stdout and logs only to stderr, without keys', async () => {
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const child = spawn(process.execPath, [cli], { env: { PATH: process.env.PATH, ASL_DATA_KEY: DATA_KEY, ASL_ROUTER_KEY: ROUTER_KEY }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const deadline = Date.now() + 10_000;
  while (!out.includes('"id":2') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  child.stdin.end();
  await new Promise((r) => child.on('close', r));
  const lines = out.trim().split('\n');
  for (const l of lines) assert.equal(JSON.parse(l).jsonrpc, '2.0', 'stdout carries only JSON-RPC');
  const list = lines.map((l) => JSON.parse(l)).find((m) => m.id === 2);
  assert.equal(list.result.tools.length, 11);
  assert.match(err, /running on stdio; Data API key set, router key set/);
  assert.ok(!err.includes(DATA_KEY) && !err.includes(ROUTER_KEY) && !out.includes(DATA_KEY));
});
