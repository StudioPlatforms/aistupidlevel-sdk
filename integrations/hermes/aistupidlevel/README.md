# AI Stupid Level for Hermes Agent

A model-provider plugin that adds the [AI Stupid Level](https://aistupidlevel.info/router) Smart Router to Hermes Agent.

The router is an OpenAI-compatible endpoint. Instead of a fixed model you pick a routing mode, and each request goes to the model that currently scores best on AI Stupid Level's continuously re-run benchmarks. The router calls that model with the provider keys you saved on your AI Stupid Level account (OpenAI, Anthropic, Google, DeepSeek, Kimi, GLM).

## Install

```sh
hermes plugins install aistupidlevel
```

Then create a router key at https://aistupidlevel.info/router/keys (it starts with `aism_`). Add your provider keys in the router settings on the same site.

## Use

```sh
hermes auth add aistupidlevel        # or set ASL_ROUTER_KEY
hermes --provider aistupidlevel --model auto-tooling
```

`/model` lists the live catalog. Routing modes:

| Model | Sends each request to |
|---|---|
| `auto-tooling` | the best model on the tool-use benchmark (recommended for agents) |
| `auto-coding` | the best model on the coding benchmark |
| `auto-reasoning` | the best model on the multi-turn reasoning benchmark |
| `auto-best` | the best combined score |
| `auto-task` | one of the above, chosen from the request itself |
| `auto-value` | the best score per dollar among near-top models |

A model id such as `claude-opus-5-5` pins one model. The router keeps a tool-calling conversation on one model, so an agent loop does not switch models mid-task.

## Configuration

| Variable | Purpose |
|---|---|
| `ASL_ROUTER_KEY` | Router key (`aism_…`) |
| `ASL_BASE_URL` | Optional; defaults to `https://aistupidlevel.info/v1` |

## What this plugin does (disclosure)

- **Network calls:** it registers a provider profile only. When you choose this provider, Hermes sends your prompts, tool definitions, tool results and your router key to `https://aistupidlevel.info/v1`. The router forwards each request to the AI provider it routes to, using your own provider key for that provider. Billing for model usage is on your provider accounts; AI Stupid Level adds no per-token charge.
- **Nothing else:** no tools, hooks, middleware, background processes, files read outside the plugin, or telemetry.
- **Prompt logging:** prompts are not stored by AI Stupid Level unless you enable prompt logging for a key in your account. See https://aistupidlevel.info/privacy.

Image input is not accepted: the router routes text and tool calls only.

## Licence

MIT. Source: https://github.com/StudioPlatforms/aistupidlevel-sdk/tree/main/integrations/hermes/aistupidlevel
