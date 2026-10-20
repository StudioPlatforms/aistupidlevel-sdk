// Live tests against the real APIs. Skipped without keys.
//   ASL_ROUTER_KEY=aism_... npm test   Smart Router, always in sandbox mode (nothing is spent or counted)
//   ASL_DATA_KEY=asl_live_... npm test  Data API: exactly one request (a free key allows 10 a day)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/index.js';

const routerKey = process.env.ASL_ROUTER_KEY;
const dataKey = process.env.ASL_DATA_KEY;

async function connect(opts) {
  // forceSandbox: no live test may ever send a real chat request.
  const server = createServer({ env: {}, forceSandbox: true, log: () => {}, ...opts });
  const client = new Client({ name: 'live-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError };
  };
  return { call, close: () => client.close() };
}

test('router (sandbox): preview_route, ask_router and get_usage agree with each other', { skip: !routerKey && 'set ASL_ROUTER_KEY' }, async () => {
  const c = await connect({ routerKey });
  const prompt = 'Write a function that reverses a string.';
  const p = await c.call('preview_route', { prompt, mode: 'auto-coding', sandbox: true });
  assert.equal(p.isError, false, p.text);
  assert.match(p.text, /strategy best_coding/);
  const primary = p.text.match(/Primary: (\S+) \(/)[1];
  const a = await c.call('ask_router', { prompt, mode: 'auto-coding', sandbox: true });
  assert.equal(a.isError, false, a.text);
  assert.match(a.text, /^Sandbox response from /);
  assert.match(a.text, new RegExp(`Answered by ${primary.replace(/[.]/g, '\\.')} `), 'the answer came from the previewed model');
  assert.match(a.text, /no provider was called and nothing was spent/);
  const u = await c.call('get_usage');
  assert.equal(u.isError, false, u.text);
  assert.match(u.text, /Smart Router \(\d{4}-\d\d, plan \w+\)/);
  await c.close();
});

test('data: one leaderboard request, then the cache (or a clear quota error)', { skip: !dataKey && 'set ASL_DATA_KEY' }, async (t) => {
  const c = await connect({ dataKey });
  const r = await c.call('get_leaderboard', { limit: 3 });
  if (r.isError && /daily limit|per-minute limit/.test(r.text)) {
    assert.match(r.text, /https:\/\/aistupidlevel\.info\/pricing/);
    t.skip(`quota: ${r.text.slice(0, 120)}`);
    return c.close();
  }
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /AI Stupid Level leaderboard/);
  assert.match(r.text, /requests left today for this key: \d+ of \d+/);
  const again = await c.call('get_leaderboard', { limit: 5 });
  assert.match(again.text, /Served from this server's cache/);
  await c.close();
});
