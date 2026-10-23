# AI Stupid Level for Pi

> Stop choosing AI models manually. Let live benchmarks choose the best model for coding, reasoning, or agent tasks—using your own provider keys, with zero token markup.

A [Pi](https://pi.dev) provider for the [AI Stupid Level](https://aistupidlevel.info/router) Smart Router. Instead of a fixed model you pick a routing mode such as `auto-coding`, and the router sends each request to the model with the best measured score on AI Stupid Level's benchmarks, among the providers you connected (OpenAI, Anthropic, Google, DeepSeek, Kimi, GLM). It calls that model with your own provider key.

## Install

```sh
pi install npm:@aistupidlevel/pi-provider
```

## Set up

1. Create a router key at https://aistupidlevel.info/router/keys (it starts with `aism_`).
2. On the same site, add the provider keys the router may use.
3. Give Pi the router key. In Pi, run `/login`, choose **Sign in with an API key**, then **AI Stupid Level**, and pick a mode with `/model` afterwards. Or set an environment variable:

   ```sh
   export AISTUPIDLEVEL_API_KEY=aism_...   # ASL_ROUTER_KEY works too
   ```

   A key saved with `/login` is stored in `~/.pi/agent/auth.json` and takes precedence over the environment.

## Use

```sh
pi --model aistupidlevel/auto-coding
```

Or open `/model` and pick an AI Stupid Level mode; `Ctrl+S` there makes it the default for new sessions. The footer shows which model answered the latest request, for example `ASL → claude-sonnet-5-5`, and Pi records it with each answer in the session.

## Routing modes

| Model | Sends each request to |
|---|---|
| `auto-coding` | the best score on the coding benchmark (the default) |
| `auto-tooling` | the best score on the tool-use benchmark; suits agent work |
| `auto-reasoning` | the best score on the reasoning benchmark |
| `auto-best` | the best combined score |
| `auto-task` | the benchmark that matches each request: tools, reasoning, code or overall |
| `auto-value`, `auto-value-coding`, `auto-value-reasoning`, `auto-value-tooling` | the most benchmark points per measured dollar, among models within 5 points of the best |
| `auto-fastest-quality` | the fastest model within 5 points of the best |
| `auto-consistent` | the model whose score varies least, within 5 points of the best |
| `auto-cheapest`, `auto-fastest` | the lowest price per token, or the lowest latency, with no quality bar |
| `auto` | the strategy saved in your router preferences |
| `auto-split` | your own traffic split, set in your router preferences |

When the leaders are statistically tied, the router picks the one that cost least per task in its measurements; you can choose the fastest or the highest score instead in your router preferences. A conversation stays with the model that answered it, so an agent loop is not handed to a different model mid-task. A model id such as `aistupidlevel/claude-opus-5-5` pins one model.

The model list comes live from the router (`GET /v1/models` with your key): Pi refreshes it in the background when it starts interactively, or when you open `/model`, and keeps the last list it fetched when the router cannot be reached. Before the first refresh, the main routing modes are listed.

Full documentation: https://aistupidlevel.info/router/docs (routing modes: [#strategies](https://aistupidlevel.info/router/docs#strategies)).

## What is measured

AI Stupid Level runs its own coding, reasoning and tool-use benchmarks on the models the router chooses from and publishes the results at https://aistupidlevel.info.

- Each model ranks on the average of its last five measured runs, never on a single run.
- Value is measured, too: the benchmark score divided by what one identical benchmark run cost that model, not its list price.
- Drift-aware routing, on by default: a model whose drift detector has fired for the skill your mode relies on, or whose hourly canary is failing, moves behind every unflagged model.

## Your keys, zero markup

The router calls the chosen model with the provider key you saved on AI Stupid Level, so the provider bills you directly, at its own prices. AI Stupid Level adds 0% markup to provider tokens on every plan, and the free account includes 1,000 router requests a month ([pricing](https://aistupidlevel.info/pricing)).

That is also why these models show a cost of $0 in Pi: the price depends on which model answered, and it appears on your provider's bill.

Text and tool calls only: the router does not route image input.

## Configuration

| Variable | Purpose |
|---|---|
| `AISTUPIDLEVEL_API_KEY` | Router key (`aism_…`), when none was saved with `/login` |
| `ASL_ROUTER_KEY` | Read when `AISTUPIDLEVEL_API_KEY` is not set |

To reach the router through another endpoint, such as a company proxy, set its `baseUrl` in Pi's `~/.pi/agent/models.json`:

```json
{ "providers": { "aistupidlevel": { "baseUrl": "https://proxy.example.com/v1" } } }
```

Every model is declared with a 262,144-token context window and 64,000 output tokens: the smallest limits across the router's pool, so they hold for any model it picks.

## What this extension does (disclosure)

- **Network calls:** it registers one model provider. When you use it, Pi sends your prompts, tool definitions, tool results and your router key to `https://aistupidlevel.info/v1`. The extension itself calls `GET /v1/models` with your key to list models. The router forwards each request to the provider it routes to, using your own key for that provider.
- **Nothing else:** no tools, commands, files read or written, background processes or telemetry. It reads the `X-AISM-Model` response header to show the answering model in the footer.
- **Prompt logging:** prompts are not stored by AI Stupid Level unless you enable prompt logging for a key in your account. See https://aistupidlevel.info/privacy.

## Development

```sh
npm install
npm test                               # typecheck and unit tests
ASL_ROUTER_KEY=aism_... npm test       # adds live tests in sandbox mode: real routing, mock answers, nothing spent
pi -e ./index.ts --model aistupidlevel/auto-coding
```

Pi loads `index.ts` directly; there is no build step. Built and tested against Pi 1.4.0 (`@earendil-works/pi-coding-agent`) on Node 22.

## Licence

MIT
