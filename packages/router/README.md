# @aistupidlevel/router

TypeScript client for the [AI Stupid Level Smart Router](https://aistupidlevel.info/router): one
OpenAI-compatible endpoint that sends every request to the model measuring best for that kind of
work, based on benchmarks that are re-run continuously. You call it with your own provider keys
(OpenAI, Anthropic, Google, DeepSeek, Kimi, GLM).

- No dependencies. It uses the built-in `fetch` and runs on Node 18+, as ESM or CommonJS.
- **Routing on every answer:** which model answered, why it was chosen, and whether a fallback answered.
- **Safe retries:** backoff, `Retry-After`, and an automatic `Idempotency-Key`, so a retried request is never charged twice.
- **Typed errors** that say whose problem it is: your request, your account, your provider key, the provider, or the network.
- Streaming, a tool-calling loop helper, route previews, usage, and a free **sandbox** for tests.

```sh
npm install @aistupidlevel/router
```

## Quick start

Create a router key at <https://aistupidlevel.info/router/keys>, add at least one provider key, and:

```ts
import { ASLRouter } from '@aistupidlevel/router';

const router = new ASLRouter(); // reads ASL_ROUTER_KEY

const r = await router.chat.completions.create({
  model: 'auto-coding',
  messages: [{ role: 'user', content: 'Fix the off-by-one in this loop: ...' }],
});

console.log(r.choices[0].message.content);
console.log(r.routing.model);     // e.g. "claude-opus-5-5"
console.log(r.routing.reasoning); // why it was chosen
```

Request and response bodies follow OpenAI Chat Completions: `tools`, `tool_choice`,
`response_format` (`json_object` / `json_schema`), `reasoning_effort`, `max_completion_tokens`, and
so on. `routing` is a non-enumerable property, so `JSON.stringify(r)` stays exactly the OpenAI shape.

## Routing modes

Pass one of these as `model`, or any real model id (for example `gpt-6-sol`) to pin a model.

| Model | Routes to |
|---|---|
| `auto` | the strategy saved in your Preferences |
| `auto-coding`, `auto-reasoning`, `auto-tooling` | the top model on that benchmark |
| `auto-best` | the highest combined score |
| `auto-value`, `auto-value-coding`, `auto-value-reasoning`, `auto-value-tooling` | most points per measured dollar, among models within 5 points of the best |
| `auto-consistent`, `auto-fastest-quality` | the steadiest, or the fastest, near-top model |
| `auto-task` | reads each request and picks the matching benchmark |
| `auto-fastest`, `auto-cheapest` | lowest latency, or lowest list price (no quality bar) |

`auto-agentic` is an alias for `auto-tooling`. See the full list in the
[docs](https://aistupidlevel.info/router/docs#strategies).

## Streaming

```ts
const stream = await router.chat.completions.create({ model: 'auto-best', messages, stream: true });
console.log(stream.routing.model); // known before the first chunk

for await (const text of stream.textStream()) process.stdout.write(text);
// or: for await (const chunk of stream) { ... }
// or: const completion = await stream.finalCompletion();  // tool calls assembled for you
```

If the chosen model fails before sending anything, the router moves to the next model. If a stream
breaks after it has started, a `StreamInterruptedError` is thrown; it never ends silently.

## Tool calling

`runTools` runs a tool-calling conversation through to the final answer. It calls your handlers and
sends their results back to the model. If a handler throws, the error goes to the model as the
tool's result instead of crashing your app. The whole loop stays on one model.

```ts
const { completion, messages: transcript, rounds } = await router.chat.runTools(
  { model: 'auto-tooling', messages, tools },
  {
    handlers: { get_weather: async ({ city }) => ({ city, temp: 7 }) },
    maxRounds: 10,
  },
);
```

A forced `tool_choice` (`required`, or a named function) applies to the first turn only.

## Errors

Every error extends `ASLError` and carries:

- `status`, `code` and `requestId`;
- `retryable`;
- `party`: one of `request`, `account`, `provider_key`, `provider`, `router` or `network`.

Use `party` to decide what to tell your user.

```ts
import { AllowanceExhaustedError, ProviderKeyError, ASLError } from '@aistupidlevel/router';

try {
  await router.chat.completions.create({ model: 'auto', messages });
} catch (e) {
  if (e instanceof AllowanceExhaustedError) { /* plan used up: upgrade or buy credits */ }
  else if (e instanceof ProviderKeyError) { /* add or fix a provider key */ }
  else if (e instanceof ASLError && e.retryable) { /* transient: already retried twice */ }
  else throw e;
}
```

| Class | When | Retried |
|---|---|---|
| `AuthenticationError` | missing, invalid or expired router key (401) | no |
| `BadRequestError` | the request cannot be routed as sent | no |
| `ProviderKeyError` | no provider key, or the provider refused it | no |
| `AllowanceExhaustedError` | the monthly allowance is used up and there are no credits | no |
| `BudgetExceededError` | the key's hard monthly budget is reached | no |
| `ProviderQuotaError` | your provider account is out of credit or quota | no |
| `RateLimitError` | too many requests (honours `Retry-After`) | yes |
| `ModelUnavailableError` | every model in the chain failed on the provider side | yes |
| `ServerError`, `ConnectionError`, `TimeoutError` | transient | yes |
| `StreamInterruptedError` | a stream broke after it started | no |

Retries use exponential backoff with jitter (0.5 s, 1 s, 2 s, and so on, up to 8 s) and respect the
server's `x-should-retry` and `Retry-After` headers.

## Sandbox: test without spending anything

In sandbox mode each request goes through the real routing, as if you had a key for every provider.
It then gets a deterministic mock answer in exactly the real shape: streaming chunks, tool calls
with arguments that fit your schema, and JSON that fits your `response_format`. No provider is
called, and nothing is spent or counted against your plan.

```ts
const test = new ASLRouter({ sandbox: true });

const r = await test.chat.completions.create({ model: 'auto-coding', messages });
r.routing.sandbox; // true

// Make a request fail the way a real one can:
await test.chat.completions.create({ model: 'auto', messages }, { simulate: 'allowance_exhausted' });
// throws AllowanceExhaustedError
```

`simulate` accepts:

- `rate_limited`
- `allowance_exhausted`
- `insufficient_quota`
- `provider_key_rejected`
- `model_unavailable`
- `server_error`
- `fallback`: the first model fails and the next one answers.

## Preview, usage, feedback

```ts
// The decision a request would get, without sending it. Nothing is called or counted.
const p = await router.route.preview({ model: 'auto-coding', messages });
p.primary.model;
p.fallbacks.map(f => f.model);

const u = await router.usage(); // this month's requests, credits, and this key's budget
u.requests.remaining;

await router.feedback(r.id, 'up'); // ratings nudge future routing
```

## Options

```ts
new ASLRouter({
  apiKey: 'aism_...',         // default: process.env.ASL_ROUTER_KEY
  baseURL: '...',             // default: https://aistupidlevel.info/v1 (or ASL_BASE_URL)
  timeout: 600_000,           // per attempt, ms. Reasoning models can think for minutes
  maxRetries: 2,
  sandbox: false,
  autoIdempotency: true,      // an Idempotency-Key on every non-streaming request
  defaultHeaders: {},
  fetch,                      // a custom fetch, if your runtime needs one
});

// Per request:
await router.chat.completions.create(params, {
  signal, timeout, maxRetries, headers, idempotencyKey, sandbox, simulate,
});

// A copy with some options changed:
const fast = router.withOptions({ timeout: 30_000, maxRetries: 0 });
```

The client refuses to run in a browser, because your router key would be visible to anyone using
the page. Call it from your server. If you really need it in a browser, pass
`dangerouslyAllowBrowser: true`.

## Links

- [API documentation](https://aistupidlevel.info/router/docs)
- [OpenAPI 3.1 description](https://aistupidlevel.info/v1/openapi.json)
- [Python SDK](https://pypi.org/project/aistupidlevel/)
- [Vercel AI SDK provider](https://www.npmjs.com/package/@aistupidlevel/ai-sdk-provider)
- [Leaderboard and methodology](https://aistupidlevel.info)

MIT licence.
