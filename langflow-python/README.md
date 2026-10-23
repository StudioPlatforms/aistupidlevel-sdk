# lfx-aistupidlevel

Stop choosing AI models manually. Let live benchmarks choose the best model for coding, reasoning, or agent tasks—using your own provider keys, with zero token markup.

This package adds the [AI Stupid Level](https://aistupidlevel.info/router) Smart Router to [Langflow](https://www.langflow.org) in two forms: a model provider for the Language Model and Agent components, and an **AI Stupid Level** component that shows which model answered.

## Install

```sh
pip install lfx-aistupidlevel
```

Install it in the same Python environment as Langflow (`uv pip install lfx-aistupidlevel` works too), then restart Langflow. Langflow loads installed extensions when it starts, so there is nothing to enable. It needs Langflow 1.12 or later.

You also need a router key (`aism_...`) from https://aistupidlevel.info/router/keys, and your provider keys (OpenAI, Anthropic, Google, DeepSeek, Kimi, GLM) added to your AI Stupid Level account.

## Where it appears in Langflow

- **Settings → Model Providers → AI Stupid Level.** Paste the router key and save; Langflow checks it against the router. Instead, you can set `AISTUPIDLEVEL_API_KEY` in Langflow's environment. Five routing modes are enabled by default (`auto-coding`, `auto-tooling`, `auto-reasoning`, `auto-best`, `auto-value`). You can switch on the other modes and the pinnable models in the same pane.
- **Language Model and Agent components.** Choose an AI Stupid Level mode, such as `auto-coding`, in the model picker. Every mode supports tool calling, so all of them appear in the Agent's picker too.
- **AI Stupid Level component**, in the components sidebar. It is a chat model with a **Model** dropdown, which defaults to `auto-coding`; click refresh to load every mode and model from the router. After each answer, the Chat Output message names the model that answered (the flow editor's chat shows it beside the sender), and the component's **Routing** log gives the router's reason for choosing it. Its **Language Model** output can drive an Agent. Leave its key field empty to use the key saved in Model Providers (or `AISTUPIDLEVEL_API_KEY`); it also accepts `ASL_ROUTER_KEY`, the variable the other AI Stupid Level SDKs read.

## Routing modes

| Mode | What it picks |
|---|---|
| `auto-coding`, `auto-reasoning`, `auto-tooling`, `auto-best` | The best measured score on AI Stupid Level's coding, reasoning, tool-use or combined benchmarks. When the leaders are statistically tied, the cheapest by default. |
| `auto-value`, `auto-value-coding`, `auto-value-reasoning`, `auto-value-tooling` | The most benchmark points per measured dollar, among models within 5 points of the best |
| `auto-fastest-quality` | The fastest model within 5 points of the best |
| `auto-cheapest`, `auto-fastest`, `auto-consistent` | The cheapest, fastest or steadiest model |
| `auto-task` | A strategy picked from the request's content |
| `auto-split` | A custom split |
| `auto` | The strategy saved in your account's preferences |

A model id such as `claude-opus-5-5` instead of a mode pins that model. Langflow reads the list from the router's `GET /v1/models`. If the router can't be reached, it falls back to the routing modes. The modes are described at https://aistupidlevel.info/router/docs#strategies.

## Your keys, zero markup

The router calls the chosen model with your own provider key, so the provider bills you directly, and AI Stupid Level adds nothing to token prices. It routes text and tool calls; image input is not supported.

## Configuration

| Setting | Where | Default |
|---|---|---|
| API key | Settings → Model Providers, or `AISTUPIDLEVEL_API_KEY` in Langflow's environment; the component's own field overrides both | none |
| `ASL_ROUTER_KEY` | Environment; read by the AI Stupid Level component when no other key is set | none |
| `ASL_BASE_URL` | Environment | `https://aistupidlevel.info/v1` |

Documentation: https://aistupidlevel.info/router/docs

## Development

```sh
pip install -e ".[test]"   # in an environment with Langflow installed
pytest
lfx extension validate src/lfx_aistupidlevel
```

MIT licence.
