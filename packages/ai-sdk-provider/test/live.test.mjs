// Through the Vercel AI SDK, against the real router in sandbox mode. Needs ASL_ROUTER_KEY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateText, streamText, tool, jsonSchema, stepCountIs } from 'ai';
import { createASL, routingFromResponse } from '../dist/index.js';

const live = { skip: !process.env.ASL_ROUTER_KEY && 'set ASL_ROUTER_KEY' };
const asl = createASL({ sandbox: true });

test('generateText: routed, with routing metadata', live, async () => {
  const r = await generateText({ model: asl('auto-coding'), prompt: 'Reverse a string in Python.' });
  assert.match(r.text, /^Sandbox response/);
  const meta = r.providerMetadata?.aistupidlevel;
  assert.ok(meta?.model && meta?.provider, 'model and provider in providerMetadata');
  const routing = routingFromResponse(r);
  assert.equal(routing.model, meta.model);
  assert.equal(routing.sandbox, true);
  assert.ok(routing.reasoning);
});

test('streamText: routed, metadata from the stream', live, async () => {
  const r = streamText({ model: asl('auto-best'), prompt: 'Say hi.' });
  let text = '';
  for await (const t of r.textStream) text += t;
  assert.match(text, /^Sandbox response/);
  const meta = (await r.providerMetadata)?.aistupidlevel;
  assert.ok(meta?.model);
});

test('tools with multi-step: the call runs and the loop finishes on one model', live, async () => {
  const calls = [];
  const r = await generateText({
    model: asl('auto-tooling'),
    prompt: 'What is the weather in Oslo?',
    tools: {
      get_weather: tool({
        description: 'Weather for a city',
        inputSchema: jsonSchema({ type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }),
        execute: async ({ city }) => { calls.push(city); return { city, temp: 7 }; },
      }),
    },
    stopWhen: stepCountIs(3),
  });
  assert.deepEqual(calls, ['sandbox']);
  assert.equal(r.steps.length, 2);
  const models = r.steps.map(s => s.providerMetadata?.aistupidlevel?.model);
  assert.equal(models[0], models[1], 'the tool loop stays on its model');
  assert.match(r.text, /temp/);
});

test('a missing key fails with a clear message at request time', async () => {
  const saved = process.env.ASL_ROUTER_KEY; delete process.env.ASL_ROUTER_KEY;
  try {
    await assert.rejects(generateText({ model: createASL({ sandbox: true })('auto'), prompt: 'x', maxRetries: 0 }), /Missing router key/);
  } finally { if (saved) process.env.ASL_ROUTER_KEY = saved; }
});
