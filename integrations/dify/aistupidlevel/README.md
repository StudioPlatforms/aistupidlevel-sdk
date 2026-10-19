# AI Stupid Level

AI Stupid Level runs coding, reasoning and tool-use benchmarks on the major AI models continuously. Its Smart Router is an OpenAI-compatible API that sends each request to the model that currently scores best for that kind of work, using **your own provider keys** (OpenAI, Anthropic, Google, DeepSeek, Moonshot/Kimi, Zhipu/GLM).

## Setup

1. Create a router key (`aism_...`) at [aistupidlevel.info/router/keys](https://aistupidlevel.info/router/keys).
2. Add at least one provider key to your AI Stupid Level account at [aistupidlevel.info/router/providers](https://aistupidlevel.info/router/providers).
3. In Dify, go to **Settings → Model Provider → AI Stupid Level** and paste the router key. The key is checked against `GET /v1/usage`, which is free and sends no prompt.

## Models

| Model | Routes to |
|---|---|
| `auto-coding` | the model with the top coding score |
| `auto-reasoning` | the model with the top reasoning score |
| `auto-tooling` | the model with the top tool-use score (best for agents) |
| `auto-best` | the highest combined score |
| `auto-task` | reads each request and picks the matching benchmark |
| `auto-value`, `auto-value-coding` | the most benchmark points per measured dollar, among near-top models |
| `auto-fastest-quality` | the fastest model within 5 points of the best |
| `auto` | the routing strategy saved on your account |

To pin one model, add a custom model with a model ID such as `claude-opus-5-5` or `gpt-6-sol` (`GET https://aistupidlevel.info/v1/models` lists them all).

All models support streaming, tool calling and agents. Provider usage is billed by each provider to your own provider account.

## Links

- API documentation: https://aistupidlevel.info/router/docs
- Source: https://github.com/StudioPlatforms/aistupidlevel-sdk/tree/main/integrations/dify/aistupidlevel
- Privacy: https://aistupidlevel.info/privacy
- Contact: hello@aistupidlevel.info
