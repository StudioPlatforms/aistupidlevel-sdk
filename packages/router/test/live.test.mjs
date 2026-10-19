// Live tests against the real router, in sandbox mode (nothing is spent or counted).
// Run with: ASL_ROUTER_KEY=aism_... npm test   (skipped without a key)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASLRouter, AllowanceExhaustedError, RateLimitError, ModelUnavailableError, ProviderKeyError, BudgetExceededError } from '../dist/index.js';

const key = process.env.ASL_ROUTER_KEY;
const live = { skip: !key && 'set ASL_ROUTER_KEY to run the live sandbox tests' };
const router = key ? new ASLRouter({ apiKey: key, sandbox: true, maxRetries: 1 }) : null;
const MSG = [{ role: 'user', content: 'Write a function that reverses a string.' }];
const TOOLS = [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }];

test('sandbox completion: real routing, mock answer, routing info', live, async () => {
  const r = await router.chat.completions.create({ model: 'auto-coding', messages: MSG });
  assert.equal(r.object, 'chat.completion');
  assert.equal(r.routing.sandbox, true);
  assert.ok(r.routing.model && r.routing.provider && r.routing.reasoning);
  assert.equal(r.model, r.routing.model);
  assert.match(r.choices[0].message.content, /^Sandbox response/);
});

test('preview agrees with the request it previews', live, async () => {
  const p = await router.route.preview({ model: 'auto-coding', messages: MSG });
  const r = await router.chat.completions.create({ model: 'auto-coding', messages: MSG });
  assert.equal(p.primary.model, r.routing.model);
  assert.equal(p.strategy, 'best_coding');
});

test('streaming in sandbox', live, async () => {
  const s = await router.chat.completions.create({ model: 'auto-best', messages: MSG, stream: true, stream_options: { include_usage: true } });
  assert.equal(s.routing.sandbox, true);
  const final = await s.finalCompletion();
  assert.match(final.choices[0].message.content, /^Sandbox response/);
  assert.ok(final.usage.total_tokens > 0);
});

test('runTools completes a tool loop on one model', live, async () => {
  const seen = [];
  const r = await router.chat.runTools({ model: 'auto-tooling', messages: [{ role: 'user', content: 'Weather in Oslo?' }], tools: TOOLS },
    { handlers: { get_weather: ({ city }) => ({ city, temp: 7 }) }, onRound: (x) => seen.push(x.completion.routing.model) });
  assert.equal(r.rounds, 2);
  assert.equal(seen[0], seen[1], 'the loop stays on its model');
  assert.match(r.completion.choices[0].message.content, /temp/);
});

test('idempotent retry is answered from the first attempt', live, async () => {
  const k = `sdk-live-${Date.now()}`;
  const a = await router.chat.completions.create({ model: 'auto', messages: MSG }, { idempotencyKey: k });
  const b = await router.chat.completions.create({ model: 'auto', messages: MSG }, { idempotencyKey: k });
  assert.equal(a.id, b.id);
  assert.equal(b.routing.replayed, true);
});

test('simulated failures map to typed errors', live, async () => {
  const cases = [['allowance_exhausted', AllowanceExhaustedError], ['insufficient_quota', BudgetExceededError], ['provider_key_rejected', ProviderKeyError], ['model_unavailable', ModelUnavailableError], ['rate_limited', RateLimitError]];
  for (const [simulate, Cls] of cases) {
    await assert.rejects(router.chat.completions.create({ model: 'auto', messages: MSG }, { simulate, maxRetries: 0 }), Cls, simulate);
  }
});

test('simulated fallback is visible in routing', live, async () => {
  const r = await router.chat.completions.create({ model: 'auto-best', messages: MSG }, { simulate: 'fallback' });
  assert.equal(r.routing.fallback, true);
});

test('usage and models', live, async () => {
  const u = await router.usage();
  assert.equal(u.object, 'usage');
  assert.ok(typeof u.requests.used === 'number');
  const m = await router.models.list();
  assert.ok(m.data.some(x => x.id === 'auto-coding'));
});
