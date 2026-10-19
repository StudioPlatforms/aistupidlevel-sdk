# @aistupidlevel/ai-sdk-provider

[AI Stupid Level Smart Router](https://aistupidlevel.info/router) provider for the
[Vercel AI SDK](https://ai-sdk.dev). The router sends every request to the model measuring best
for that kind of work, using benchmarks that are re-run continuously, with your own provider keys.
You get `generateText`, `streamText`, tools and structured output, plus the model that actually
answered.

```sh
npm install @aistupidlevel/ai-sdk-provider ai
```

Requires Node 22 or later and AI SDK 7.

## Usage

Set `ASL_ROUTER_KEY` (create a key at <https://aistupidlevel.info/router/keys>), then:

```ts
import { asl } from '@aistupidlevel/ai-sdk-provider';
import { generateText } from 'ai';

const { text, providerMetadata } = await generateText({
  model: asl('auto-coding'),
  prompt: 'Write a React hook that debounces a value',
});

providerMetadata?.aistupidlevel; // { model: 'claude-opus-5-5', provider: 'anthropic' }
```

Streaming and tools work the same way they do with any AI SDK provider:

```ts
import { streamText, tool, stepCountIs } from 'ai';
import { z } from 'zod';

const result = streamText({
  model: asl('auto-tooling'),
  prompt: 'What is the weather in Oslo?',
  tools: {
    weather: tool({
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ city, temp: 7 }),
    }),
  },
  stopWhen: stepCountIs(5),
});

for await (const text of result.textStream) process.stdout.write(text);
```

A multi-step tool loop stays on the model that started it.

## Settings

```ts
import { createASL } from '@aistupidlevel/ai-sdk-provider';

const asl = createASL({
  apiKey: 'aism_...',   // default: ASL_ROUTER_KEY, read when the request is made
  baseURL: '...',       // default: https://aistupidlevel.info/v1
  sandbox: true,        // mock answers through real routing: nothing is spent or counted
  headers: {},
});
```

Model ids:

- a routing mode: `auto`, `auto-best`, `auto-coding`, `auto-reasoning`, `auto-tooling`,
  `auto-value`, `auto-value-coding`, `auto-value-reasoning`, `auto-value-tooling`,
  `auto-consistent`, `auto-fastest-quality`, `auto-task`, `auto-fastest` or `auto-cheapest`;
- or any real model id, to pin that model.

Embeddings: `asl.embeddingModel('text-embedding-3-small')`.

For the full routing details, read the response headers with `routingFromResponse(result)`: model,
provider, the reason for the choice, the request id, and whether a fallback answered.

For retries with idempotency keys, route previews and usage, use
[`@aistupidlevel/router`](https://www.npmjs.com/package/@aistupidlevel/router).

[API documentation](https://aistupidlevel.info/router/docs) · MIT licence
