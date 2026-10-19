# aistupidlevel

Python client for the [AI Stupid Level Smart Router](https://aistupidlevel.info/router): one
OpenAI-compatible endpoint that sends every request to the model measuring best for that kind of
work, based on benchmarks that are re-run continuously. You call it with your own provider keys
(OpenAI, Anthropic, Google, DeepSeek, Kimi, GLM).

- Sync and asyncio clients. Python 3.9+, and the only dependency is `httpx`.
- **Routing on every answer:** which model answered, why it was chosen, and whether a fallback answered.
- **Safe retries:** backoff, `Retry-After`, and an automatic `Idempotency-Key`, so a retried request is never charged twice.
- **Typed errors** that say whose problem it is: your request, your account, your provider key, the provider, or the network.
- Streaming, a tool-calling loop helper, route previews, usage, and a free **sandbox** for tests.

```sh
pip install aistupidlevel
```

## Quick start

Create a router key at <https://aistupidlevel.info/router/keys>, add at least one provider key, and:

```python
from aistupidlevel import ASLRouter

router = ASLRouter()  # reads ASL_ROUTER_KEY

r = router.chat.completions.create(
    model="auto-coding",
    messages=[{"role": "user", "content": "Fix the off-by-one in this loop: ..."}],
)

print(r.choices[0].message.content)
print(r.routing.model)      # e.g. "claude-opus-5-5"
print(r.routing.reasoning)  # why it was chosen
```

Request parameters and response fields follow OpenAI Chat Completions: `tools`, `tool_choice`,
`response_format`, `reasoning_effort`, `max_completion_tokens`, and so on.

Responses are plain `dict`s that also allow attribute access, so `r["choices"][0]` and
`r.choices[0]` both work, and `json.dumps(r)` gives exactly the OpenAI shape.

## Routing modes

Pass one of these as `model`, or any real model id (for example `"gpt-6-sol"`) to pin a model:

- `auto`: the strategy saved in your Preferences.
- `auto-coding`, `auto-reasoning`, `auto-tooling`: the top model on that benchmark.
- `auto-best`: the highest combined score.
- `auto-value`, `auto-value-coding`, `auto-value-reasoning`, `auto-value-tooling`: the most points per
  measured dollar, among models within 5 points of the best.
- `auto-consistent`, `auto-fastest-quality`: the steadiest, or the fastest, near-top model.
- `auto-task`: reads each request and picks the matching benchmark.
- `auto-fastest`, `auto-cheapest`: lowest latency, or lowest list price (no quality bar).

`aistupidlevel.ROUTING_MODES` lists them all.

## Streaming

```python
with router.chat.completions.create(model="auto-best", messages=messages, stream=True) as stream:
    print(stream.routing.model)  # known before the first chunk
    for text in stream.text_stream():
        print(text, end="", flush=True)

# or iterate chunks:      for chunk in stream: ...
# or get the full answer: completion = stream.final_completion()  # tool calls assembled for you
```

If a stream breaks after it has started, `StreamInterruptedError` is raised; it never ends silently.

## Async

```python
import asyncio
from aistupidlevel import AsyncASLRouter

async def main():
    async with AsyncASLRouter() as router:
        r = await router.chat.completions.create(model="auto-reasoning", messages=messages)

        stream = await router.chat.completions.create(model="auto-best", messages=messages, stream=True)
        async for text in stream.text_stream():
            print(text, end="")

asyncio.run(main())
```

## Tool calling

`run_tools` runs a tool-calling conversation through to the final answer:

- Each handler receives the tool's arguments as keyword arguments, and may be a plain function or,
  with `AsyncASLRouter`, a coroutine.
- If a handler raises, the error goes to the model as the tool's result instead of crashing your app.
- The whole loop stays on one model.

```python
def get_weather(city: str):
    return {"city": city, "temp": 7}

out = router.chat.run_tools(
    model="auto-tooling",
    messages=[{"role": "user", "content": "Weather in Oslo?"}],
    tools=[{"type": "function", "function": {"name": "get_weather", "parameters": {
        "type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}}],
    handlers={"get_weather": get_weather},
    max_rounds=10,
)
print(out["completion"].choices[0].message.content, out["rounds"])
```

## Errors

Every error is an `ASLError` with:

- `status`, `code` and `request_id`;
- `retryable`;
- `party`: one of `request`, `account`, `provider_key`, `provider`, `router` or `network`.

```python
from aistupidlevel import ASLError, AllowanceExhaustedError, ProviderKeyError

try:
    router.chat.completions.create(model="auto", messages=messages)
except AllowanceExhaustedError:
    ...  # plan used up: upgrade or buy credits
except ProviderKeyError:
    ...  # add or fix a provider key
except ASLError as e:
    if e.retryable:
        ...  # transient, and already retried twice
    raise
```

The classes are:

- **Not retried:**
  - `AuthenticationError` and `BadRequestError`;
  - `ProviderKeyError`;
  - `AllowanceExhaustedError` and `BudgetExceededError`;
  - `ProviderQuotaError`.
- **Retried automatically:**
  - `RateLimitError` (honours `Retry-After`);
  - `ModelUnavailableError` and `ServerError`;
  - `ConnectionError` and `TimeoutError`.
- **Mid-stream:** `StreamInterruptedError`.

Retries use exponential backoff with jitter and respect the server's `x-should-retry` header.

## Sandbox: test without spending anything

In sandbox mode each request goes through the real routing, as if you had a key for every provider.
It then gets a deterministic mock answer in exactly the real shape: streaming chunks, tool calls
with arguments that fit your schema, and JSON that fits your `response_format`. No provider is
called, and nothing is spent or counted.

```python
test = ASLRouter(sandbox=True)
r = test.chat.completions.create(model="auto-coding", messages=messages)
assert r.routing.sandbox

# Make a request fail the way a real one can:
test.chat.completions.create(model="auto", messages=messages, simulate="allowance_exhausted")
# raises AllowanceExhaustedError
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

```python
p = router.route.preview(model="auto-coding", messages=messages)  # nothing is sent or counted
p.primary.model, [f.model for f in p.fallbacks]

u = router.usage()  # this month's requests, credits, and this key's budget
u.requests.remaining

router.feedback(r.id, "up")  # ratings nudge future routing
```

## Options

```python
ASLRouter(
    api_key="aism_...",      # default: ASL_ROUTER_KEY
    base_url="...",          # default: https://aistupidlevel.info/v1 (or ASL_BASE_URL)
    timeout=600.0,           # per attempt, seconds. Reasoning models can think for minutes
    max_retries=2,
    sandbox=False,
    auto_idempotency=True,   # an Idempotency-Key on every non-streaming request
    default_headers={},
    http_client=None,        # your own httpx.Client (proxies, transports, ...)
)

# Per request:
router.chat.completions.create(..., timeout=30, max_retries=0, extra_headers={},
                               idempotency_key="...", sandbox=True, simulate="fallback")

# A copy with some options changed:
fast = router.with_options(timeout=30, max_retries=0)
```

## Links

- [API documentation](https://aistupidlevel.info/router/docs)
- [OpenAPI 3.1 description](https://aistupidlevel.info/v1/openapi.json)
- [TypeScript SDK](https://www.npmjs.com/package/@aistupidlevel/router)
- [Leaderboard and methodology](https://aistupidlevel.info)

MIT licence.
