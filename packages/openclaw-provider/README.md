# AI Stupid Level for OpenClaw

An OpenClaw provider plugin for the [AI Stupid Level](https://aistupidlevel.info/router) Smart Router.

The router is an OpenAI-compatible endpoint. Instead of a fixed model you pick a routing mode, and each request goes to the model that currently scores best on AI Stupid Level's continuously re-run benchmarks. The router calls that model with the provider keys you saved on your AI Stupid Level account (OpenAI, Anthropic, Google, DeepSeek, Kimi, GLM).

## Install

```sh
openclaw plugins install clawhub:@aistupidlevel/openclaw-provider
```

## Set up

1. Create a router key at https://aistupidlevel.info/router/keys (it starts with `aism_`).
2. Add your provider keys in the router settings on the same site.
3. Give OpenClaw the router key, either through onboarding or as an environment variable:

```sh
openclaw onboard --aistupidlevel-api-key aism_...
# or
export ASL_ROUTER_KEY=aism_...
```

## Use

```sh
openclaw agent --model aistupidlevel/auto-tooling -m "..."
```

The model list comes live from the router (`GET /v1/models` with your key). Routing modes:

| Model | Sends each request to |
|---|---|
| `aistupidlevel/auto-tooling` | the best model on the tool-use benchmark (the default; suits agents) |
| `aistupidlevel/auto-coding` | the best model on the coding benchmark |
| `aistupidlevel/auto-reasoning` | the best model on the multi-turn reasoning benchmark |
| `aistupidlevel/auto-best` | the best combined score |
| `aistupidlevel/auto-task` | one of the above, chosen from the request itself |
| `aistupidlevel/auto-value` | the best score per dollar among near-top models |

A model id such as `aistupidlevel/claude-opus-5-5` pins one model. OpenClaw shows which model the router chose (`Model route changed: aistupidlevel/auto-tooling → aistupidlevel/claude-sonnet-5-5`). The router keeps a tool-calling conversation on one model, so an agent loop does not switch models mid-task.

## Configuration

| Variable | Purpose |
|---|---|
| `ASL_ROUTER_KEY` | Router key (`aism_…`) |
| `ASL_BASE_URL` | Optional; defaults to `https://aistupidlevel.info/v1` |

## What this plugin does (disclosure)

- **Network calls:** it registers one text-inference provider. When you use it, OpenClaw sends your prompts, tool definitions, tool results and your router key to `https://aistupidlevel.info/v1`. The plugin itself calls `GET /v1/models` with your key to list models. The router forwards each request to the AI provider it routes to, using your own key for that provider. Model usage is billed to your provider accounts; AI Stupid Level adds no per-token charge.
- **Nothing else:** no tools, hooks, channels, background processes, files read outside the plugin, or telemetry.
- **Prompt logging:** prompts are not stored by AI Stupid Level unless you enable prompt logging for a key in your account. See https://aistupidlevel.info/privacy.

Image input is not accepted: the router routes text and tool calls only.

## Development

```sh
npm install
npm test        # builds dist/ and runs the unit tests
npm pack && openclaw plugins install npm-pack:./aistupidlevel-openclaw-provider-0.1.0.tgz --force --accept-capabilities
```

Built and tested against OpenClaw 2026.10.5.

## Licence

MIT
