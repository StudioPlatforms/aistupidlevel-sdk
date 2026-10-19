// Offline tests against a local fake router: retries, timeouts, aborts, errors, streaming, tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  ASLRouter, AllowanceExhaustedError, AuthenticationError, BadRequestError, ConnectionError, RateLimitError,
  ServerError, StreamInterruptedError, TimeoutError, AbortError, ProviderKeyError, ModelUnavailableError, routingFromHeaders,
} from '../dist/index.js';

/** A fake router: `handler(req, body, n)` per request; returns { url, requests, close }. */
async function fake(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const entry = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
    requests.push(entry);
    await handler(req, res, entry, requests.length);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/v1`, requests, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}
const json = (res, status, obj, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
const completion = (text = 'hi', model = 'gpt-6-luna') => ({ id: 'chatcmpl-1', object: 'chat.completion', created: 1, model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
const ROUTING = { 'X-AISM-Provider': 'openai', 'X-AISM-Model': 'gpt-6-luna', 'X-AISM-Reasoning': 'Selected gpt-6-luna for best value', 'X-AISM-Latency': '812', 'X-AISM-Request-Id': 'chatcmpl-1' };
const client = (url, extra = {}) => new ASLRouter({ apiKey: 'aism_test', baseURL: url, maxRetries: 2, ...extra });
const MSG = [{ role: 'user', content: 'Hi' }];

test('sends the key, client header and body; returns the completion with routing info', async () => {
  const f = await fake((req, res) => json(res, 200, completion('ok'), ROUTING));
  const r = await client(f.url).chat.completions.create({ model: 'auto-value', messages: MSG });
  assert.equal(r.choices[0].message.content, 'ok');
  assert.equal(r.routing.model, 'gpt-6-luna');
  assert.equal(r.routing.provider, 'openai');
  assert.equal(r.routing.latencyMs, 812);
  assert.equal(r.routing.fallback, false);
  assert.equal(JSON.stringify(r).includes('routing'), false, 'routing must not change the JSON shape');
  const q = f.requests[0];
  assert.equal(q.headers.authorization, 'Bearer aism_test');
  assert.match(q.headers['x-asl-client'], /^asl-router-js\//);
  assert.match(q.headers['idempotency-key'], /^asl-/);
  assert.deepEqual(q.body, { model: 'auto-value', messages: MSG });
  await f.close();
});

test('retries 5xx with the same idempotency key, then succeeds', async () => {
  const f = await fake((req, res, e, n) => n < 3 ? json(res, 500, { error: { message: 'boom', code: 'internal_error' } }) : json(res, 200, completion(), ROUTING));
  const r = await client(f.url).chat.completions.create({ model: 'auto', messages: MSG });
  assert.equal(r.id, 'chatcmpl-1');
  assert.equal(f.requests.length, 3);
  const keys = new Set(f.requests.map(q => q.headers['idempotency-key']));
  assert.equal(keys.size, 1, 'every attempt must carry the same key');
  await f.close();
});

test('gives up after maxRetries with a typed ServerError', async () => {
  const f = await fake((req, res) => json(res, 503, { error: { message: 'down' } }));
  await assert.rejects(client(f.url, { maxRetries: 1 }).chat.completions.create({ model: 'auto', messages: MSG }), (e) => e instanceof ServerError && e.status === 503 && e.retryable);
  assert.equal(f.requests.length, 2);
  await f.close();
});

test('honours Retry-After on 429 rate_limited', async () => {
  const f = await fake((req, res, e, n) => n === 1 ? json(res, 429, { error: { message: 'slow down', code: 'rate_limited' } }, { 'Retry-After': '1' }) : json(res, 200, completion(), ROUTING));
  const t0 = Date.now();
  await client(f.url).chat.completions.create({ model: 'auto', messages: MSG });
  assert.ok(Date.now() - t0 >= 950, 'waited for Retry-After');
  assert.equal(f.requests.length, 2);
  await f.close();
});

test('does not retry when the router says x-should-retry: false (allowance exhausted)', async () => {
  const f = await fake((req, res) => json(res, 429, { error: { message: 'used up', code: 'allowance_exhausted' } }, { 'x-should-retry': 'false' }));
  await assert.rejects(client(f.url).chat.completions.create({ model: 'auto', messages: MSG }), (e) => e instanceof AllowanceExhaustedError && e.party === 'account' && !e.retryable);
  assert.equal(f.requests.length, 1);
  await f.close();
});

test('never retries a 400 and maps codes to classes', async () => {
  const cases = [
    [400, 'model_not_found', BadRequestError, 'request'],
    [400, 'no_provider_keys', ProviderKeyError, 'provider_key'],
    [401, 'invalid_api_key', AuthenticationError, 'request'],
    [502, 'model_unavailable', ModelUnavailableError, 'provider'],
  ];
  for (const [status, code, Cls, party] of cases) {
    const f = await fake((req, res) => json(res, status, { error: { message: code, code, type: 'x' } }, { 'X-AISM-Request-Id': 'req-9' }));
    await assert.rejects(client(f.url, { maxRetries: 0 }).chat.completions.create({ model: 'auto', messages: MSG }),
      (e) => e instanceof Cls && e.code === code && e.party === party && e.requestId === 'req-9');
    await f.close();
  }
});

test('times out, retries, then raises TimeoutError', async () => {
  const f = await fake(() => { /* never answer */ });
  await assert.rejects(client(f.url, { timeout: 150, maxRetries: 1 }).chat.completions.create({ model: 'auto', messages: MSG }), (e) => e instanceof TimeoutError && e.retryable);
  assert.equal(f.requests.length, 2);
  await f.close();
});

test('an AbortSignal cancels without retrying', async () => {
  const f = await fake(() => { /* hang */ });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 100);
  await assert.rejects(client(f.url).chat.completions.create({ model: 'auto', messages: MSG }, { signal: ac.signal }), (e) => e instanceof AbortError);
  assert.equal(f.requests.length, 1);
  await f.close();
});

test('connection refused is retried, then ConnectionError', async () => {
  const f = await fake(() => {});
  const url = f.url; await f.close();
  await assert.rejects(client(url, { maxRetries: 1 }).chat.completions.create({ model: 'auto', messages: MSG }), (e) => e instanceof ConnectionError);
});

function sse(res, events, { done = true, split = false, headers = {} } = {}) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', ...ROUTING, ...headers });
  let payload = events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join('') + (done ? 'data: [DONE]\n\n' : '');
  if (!split) { res.end(payload); return; }
  // Deliver in 7-byte pieces: events and JSON split across reads.
  let i = 0;
  const tick = () => { if (i >= payload.length) return res.end(); res.write(payload.slice(i, i + 7)); i += 7; setImmediate(tick); };
  tick();
}
const ch = (delta, finish = null, extra = {}) => ({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'claude-opus-5-5', choices: [{ index: 0, delta, finish_reason: finish }], ...extra });

test('streams text, split across reads, and assembles the final completion', async () => {
  const f = await fake((req, res) => sse(res, [ch({ role: 'assistant', content: '' }), ch({ content: 'Hello, ' }), ch({ content: 'world' }), ch({}, 'stop'),
    { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'claude-opus-5-5', choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }], { split: true }));
  const stream = await client(f.url).chat.completions.create({ model: 'auto-best', messages: MSG, stream: true });
  assert.equal(stream.routing.model, 'gpt-6-luna');
  let text = '';
  for await (const t of stream.textStream()) text += t;
  assert.equal(text, 'Hello, world');
  const final = await stream.finalCompletion();
  assert.equal(final.choices[0].message.content, 'Hello, world');
  assert.equal(final.usage.total_tokens, 5);
  assert.equal(final.routing.model, 'gpt-6-luna', 'the final completion carries routing');
  assert.equal(JSON.parse(JSON.stringify(final)).routing, undefined, 'routing stays out of the JSON');
  assert.equal(f.requests[0].headers['idempotency-key'], undefined, 'streams carry no idempotency key');
  await f.close();
});

test('assembles streamed tool calls', async () => {
  const f = await fake((req, res) => sse(res, [
    ch({ role: 'assistant', content: '' }),
    ch({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":' } }] }),
    ch({ tool_calls: [{ index: 0, function: { arguments: '"Oslo"}' } }] }),
    ch({}, 'tool_calls')]));
  const stream = await client(f.url).chat.completions.create({ model: 'auto-tooling', messages: MSG, stream: true });
  const final = await stream.finalCompletion();
  assert.equal(final.choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(final.choices[0].message.tool_calls, [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Oslo"}' } }]);
  assert.equal(final.choices[0].message.content, null);
  await f.close();
});

test('a mid-stream error chunk raises StreamInterruptedError', async () => {
  const f = await fake((req, res) => sse(res, [ch({ content: 'part' }), { error: { message: 'model stopped', code: 'stream_interrupted', type: 'server_error' } }]));
  const stream = await client(f.url).chat.completions.create({ model: 'auto', messages: MSG, stream: true });
  await assert.rejects(stream.finalCompletion(), (e) => e instanceof StreamInterruptedError && e.code === 'stream_interrupted');
  await f.close();
});

test('a stream that ends without [DONE] raises StreamInterruptedError', async () => {
  const f = await fake((req, res) => sse(res, [ch({ content: 'part' })], { done: false }));
  const stream = await client(f.url).chat.completions.create({ model: 'auto', messages: MSG, stream: true });
  await assert.rejects(stream.finalCompletion(), StreamInterruptedError);
  await f.close();
});

test('a stream is retried before it starts, never after', async () => {
  const f = await fake((req, res, e, n) => n === 1 ? json(res, 502, { error: { message: 'x', code: 'model_unavailable' } }) : sse(res, [ch({ content: 'ok' }), ch({}, 'stop')]));
  const stream = await client(f.url).chat.completions.create({ model: 'auto', messages: MSG, stream: true });
  assert.equal((await stream.finalCompletion()).choices[0].message.content, 'ok');
  assert.equal(f.requests.length, 2);
  await f.close();
});

test('abort() stops a running stream', async () => {
  const f = await fake((req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream', ...ROUTING }); res.write(`data: ${JSON.stringify(ch({ content: 'a' }))}\n\n`); /* then hang */ });
  const stream = await client(f.url).chat.completions.create({ model: 'auto', messages: MSG, stream: true });
  const seen = [];
  await assert.rejects((async () => { for await (const c of stream) { seen.push(c); stream.abort(); } })(), AbortError);
  assert.equal(seen.length, 1);
  await f.close();
});

test('runTools runs handlers, feeds results back, and returns the final answer', async () => {
  const f = await fake((req, res, e, n) => {
    if (n === 1) {
      assert.deepEqual(e.body.tool_choice, { type: 'function', function: { name: 'get_weather' } });
      return json(res, 200, { ...completion(), choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Oslo"}' } }] }, finish_reason: 'tool_calls' }] }, ROUTING);
    }
    assert.equal(e.body.tool_choice, 'auto', 'a forced choice applies to the first turn only');
    const toolMsg = e.body.messages.find(m => m.role === 'tool');
    assert.deepEqual(JSON.parse(toolMsg.content), { temp: 7, city: 'Oslo' });
    return json(res, 200, completion('It is 7 degrees in Oslo.'), ROUTING);
  });
  const tools = [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }];
  const rounds = [];
  const r = await client(f.url).chat.runTools(
    { model: 'auto-tooling', messages: MSG, tools, tool_choice: { type: 'function', function: { name: 'get_weather' } } },
    { handlers: { get_weather: async ({ city }) => ({ temp: 7, city }) }, onRound: (x) => rounds.push(x.index) });
  assert.equal(r.completion.choices[0].message.content, 'It is 7 degrees in Oslo.');
  assert.equal(r.rounds, 2);
  assert.deepEqual(rounds, [0, 1]);
  assert.deepEqual(r.messages.map(m => m.role), ['user', 'assistant', 'tool', 'assistant']);
  await f.close();
});

test('runTools reports a failing handler to the model instead of crashing', async () => {
  const f = await fake((req, res, e, n) => n === 1
    ? json(res, 200, { ...completion(), choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'boom', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }, ROUTING)
    : (assert.match(e.body.messages.at(-1).content, /broken/), json(res, 200, completion('recovered'), ROUTING)));
  const r = await client(f.url).chat.runTools({ model: 'auto', messages: MSG, tools: [{ type: 'function', function: { name: 'boom' } }] }, { handlers: { boom: () => { throw new Error('broken'); } } });
  assert.equal(r.completion.choices[0].message.content, 'recovered');
  await f.close();
});

test('sandbox and simulate become headers; withOptions copies the client', async () => {
  const f = await fake((req, res) => json(res, 200, completion(), { ...ROUTING, 'X-AISM-Sandbox': 'true' }));
  const sb = client(f.url).withOptions({ sandbox: true });
  const r = await sb.chat.completions.create({ model: 'auto', messages: MSG }, { simulate: 'fallback' });
  assert.equal(r.routing.sandbox, true);
  assert.equal(f.requests[0].headers['x-asl-sandbox'], 'true');
  assert.equal(f.requests[0].headers['x-asl-sandbox-simulate'], 'fallback');
  await f.close();
});

test('preview, usage, feedback and models hit the right paths', async () => {
  const f = await fake((req, res, e) => json(res, 200, { path: e.url, method: e.method, body: e.body }));
  const c = client(f.url);
  assert.equal((await c.route.preview({ model: 'auto-coding' })).path, '/v1/route/preview');
  assert.equal((await c.usage()).path, '/v1/usage');
  const fb = await c.feedback('chatcmpl-1', 'up');
  assert.deepEqual(fb.body, { id: 'chatcmpl-1', rating: 'up' });
  assert.equal((await c.models.list()).method, 'GET');
  await f.close();
});

test('refuses to run without a key, and in a browser unless allowed', () => {
  const saved = process.env.ASL_ROUTER_KEY; delete process.env.ASL_ROUTER_KEY;
  assert.throws(() => new ASLRouter({}), /Missing router key/);
  if (saved) process.env.ASL_ROUTER_KEY = saved;
  globalThis.window = {}; globalThis.document = {};
  try {
    assert.throws(() => new ASLRouter({ apiKey: 'aism_x' }), /browser/);
    assert.doesNotThrow(() => new ASLRouter({ apiKey: 'aism_x', dangerouslyAllowBrowser: true }));
  } finally { delete globalThis.window; delete globalThis.document; }
});

test('routingFromHeaders reads a fallback', () => {
  const r = routingFromHeaders({ 'x-aism-model': 'gpt-6-sol', 'x-aism-reasoning': 'Fallback activated: claude-opus-5-5 failed -> routed to gpt-6-sol.' });
  assert.equal(r.fallback, true);
  assert.equal(r.latencyMs, null);
});

test('the CommonJS build loads', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const cjs = require('../dist/cjs/index.js');
  assert.equal(typeof cjs.ASLRouter, 'function');
  assert.equal(typeof cjs.RateLimitError, 'function');
});
