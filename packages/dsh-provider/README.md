# AI Stupid Level for DeepSeek Harness

Adds the [AI Stupid Level](https://aistupidlevel.info/router) Smart Router to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) as a provider route, `aistupidlevel`.

Instead of a fixed model you pick a routing mode. Each request goes to the model that scores best for that mode on AI Stupid Level's continuously re-run benchmarks, among the providers you connected (OpenAI, Anthropic, Google, DeepSeek, Kimi, GLM). The router calls that model with your own provider keys and adds nothing to token prices.

| Model | Sends each request to |
|---|---|
| `auto-coding` | the best model on the coding benchmark |
| `auto-tooling` | the best model on the tool-use benchmark (suits agent work) |
| `auto-reasoning` | the best model on the multi-turn reasoning benchmark |
| `auto-best` | the best combined score |
| `auto-task` | one of the above, chosen from the request itself |
| `auto-value` | the best score per dollar among near-top models |
| `auto-fastest-quality` | the fastest of the strong models |

## Install

```sh
dsh plugin --profile web add @aistupidlevel/dsh-provider
```

Replace `web` with your profile. The bundle supports DeepSeek Harness 0.2.0-rc.2 and 0.2.1-rc.2.

## Set up

1. Create a router key at https://aistupidlevel.info/router/keys (it starts with `aism_`), and add your provider keys in the router settings on the same site.
2. Make the key available to DeepSeek Harness as `ASL_ROUTER_KEY`:

   ```sh
   export ASL_ROUTER_KEY=aism_...
   ```

3. Choose **AI Stupid Level** and a routing mode on the Models page, or make it the default in your profile's `cordis.patch.yml`:

   ```yaml
   - id: agent-default-model
     config:
       provider: aistupidlevel
       model: auto-coding
   ```

## How it works

The bundle adds the `aistupidlevel` route to DeepSeek Harness's own pi-ai adapter (`@deepseek-ai/dsh-llm-pi-ai`) as an OpenAI-compatible gateway at `https://aistupidlevel.info/v1`. There is no code of its own: streaming, tool calls and retries are the adapter's. It does not change your default model.

**If you configure other pi-ai providers yourself:** a later layer that sets `llm-pi-ai` providers replaces the list this bundle adds, so copy the `aistupidlevel` block from [`cordis.patch.yml`](cordis.patch.yml) into your own list.

To pin one model instead of a routing mode, add its id (for example `claude-opus-5-5`) to the route's `models` list in your own layer. The router's live model list is at `GET https://aistupidlevel.info/v1/models`.

## What this bundle does (disclosure)

- **Network calls:** when you select the `aistupidlevel` route, DeepSeek Harness sends your prompts, tool definitions, tool results and your router key to `https://aistupidlevel.info/v1`. The router forwards each request to the AI provider it routes to, using your own key for that provider. Model usage is billed to your provider accounts.
- **Nothing else:** the bundle contains only a configuration layer: no code, tools, hooks or telemetry.
- **Prompt logging:** prompts are not stored by AI Stupid Level unless you enable prompt logging for a key in your account. See https://aistupidlevel.info/privacy.

Text and tool calls only: the router does not accept image input.

## Licence

MIT
