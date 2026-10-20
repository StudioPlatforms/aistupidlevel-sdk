# n8n-nodes-aistupidlevel

This is an n8n community node package for [AI Stupid Level](https://aistupidlevel.info) (ASL). It lets you use the
ASL Smart Router and ASL benchmark data in your n8n workflows.

- The **Smart Router** is one OpenAI-compatible endpoint. It sends each request to the model that measures best for that
  kind of work (coding, reasoning, tool use, value, speed and more) on benchmarks that are re-run continuously. It
  answers with your own provider keys, and every answer says which model answered and why.
- The **Data API** gives you the benchmark results: the leaderboard, model details and score history, drift signatures,
  incidents, alerts, recommendations and provider status.

The package contains two nodes:

| Node | What it does |
|---|---|
| **AI Stupid Level** | Send a message through the router, preview a route, check usage, rate an answer, list models, and read benchmark data. It can also be used as a tool by an AI Agent. |
| **AI Stupid Level Chat Model** | A chat model sub-node for the **AI Agent** and the LLM chain nodes. Every call the agent makes is routed. |

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation) ·
[Credentials](#credentials) ·
[Operations](#operations) ·
[AI Stupid Level Chat Model](#ai-stupid-level-chat-model) ·
[Usage](#usage) ·
[Compatibility](#compatibility) ·
[Resources](#resources) ·
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community
nodes documentation.

1. In n8n, open **Settings → Community Nodes**.
2. Select **Install**.
3. Enter `n8n-nodes-aistupidlevel` and confirm.

The package has no runtime dependencies.

## Credentials

The package uses two credentials, one per API. You only need the one for the operations you use.

### AI Stupid Level Router API

Used by the **Chat** and **Router** resources and by the **AI Stupid Level Chat Model**.

1. Sign in at [aistupidlevel.info](https://aistupidlevel.info) and add your provider keys (OpenAI, Anthropic, Google,
   DeepSeek, Kimi, GLM) in the router settings. The router answers with these keys.
2. Create a router key at <https://aistupidlevel.info/router/keys>. It starts with `aism_`.
3. In n8n, create an **AI Stupid Level Router API** credential and paste the key.

n8n tests the key with `GET /v1/usage`, which is free and is not counted as a routed request.

### AI Stupid Level Data API

Used by the **Benchmark** resource.

1. Create a Data API key at <https://aistupidlevel.info/account/data-keys>. It starts with `asl_live_`.
2. In n8n, create an **AI Stupid Level Data API** credential and paste the key.

n8n tests the key with `GET /api/v1/me`, which returns the key's tier and limits. The free tier allows 10 requests a day
and 1 a minute, and the test counts as one of them. The latest run (`period=latest`) needs a paid plan; the free tier
reads the 24-hour, 7-day and 30-day views. See the [Data API documentation](https://aistupidlevel.info/api-docs).

## Operations

### Chat

- **Send Message**: send a prompt (and an optional system message) to the model the router picks. The output has the
  answer and the routing decision:

  ```json
  {
    "answer": "...",
    "model": "claude-opus-5-5",
    "provider": "anthropic",
    "routingReason": "Selected claude-opus-5-5 from anthropic for best coding performance ...",
    "requestId": "chatcmpl-...",
    "finishReason": "stop",
    "usage": { "prompt_tokens": 11, "completion_tokens": 35, "total_tokens": 46 },
    "latencyMs": 2353,
    "sandbox": false,
    "fallback": false
  }
  ```

  Turn off **Simplify Output** to get the full OpenAI-style completion with a `routing` object.

  **Routing Mode** chooses how the model is picked:

  | Mode | Model id | Picks |
  |---|---|---|
  | Auto (Saved Preference) | `auto` | The strategy saved in your router preferences |
  | Best Overall | `auto-best` | Highest combined score |
  | Best for Coding / Reasoning / Tool Use | `auto-coding`, `auto-reasoning`, `auto-tooling` | Highest score on that suite |
  | Best Value (overall, coding, reasoning, tool use) | `auto-value`, `auto-value-coding`, `auto-value-reasoning`, `auto-value-tooling` | Most points per measured dollar, among models within 5 points of the best |
  | Most Consistent | `auto-consistent` | Among models within 5 points of the best, the one whose score varies least |
  | Fastest Near the Top | `auto-fastest-quality` | The fastest model within 5 points of the best |
  | Fastest / Cheapest | `auto-fastest`, `auto-cheapest` | Lowest latency / lowest list price, with no quality bar |
  | Match the Task | `auto-task` | Reads each request and picks the matching benchmark |
  | Your Traffic Split | `auto-split` | The weighted split you set in your router preferences |
  | Pin a Model | a model id | Always that model, with no routing |

  Options: **System Message**, **Sampling Temperature**, **Maximum Tokens**, **Reasoning Effort** (`none` to `max`;
  a level a model does not support is mapped to the nearest one it does), **JSON Output** (asks for a JSON object and
  parses it into `answerJson`), **Timeout** and **Sandbox**.

  **Sandbox** runs the real routing but returns a mock answer: nothing is sent to a provider and nothing is spent. Use it
  while you build a workflow.

  Each request carries an `Idempotency-Key` derived from the n8n instance, execution, node, run, item and request body.
  If n8n's **Retry On Fail** repeats a request whose answer was lost, the router returns the stored answer (for up to 24
  hours) instead of answering, and charging, twice. A failed or rate-limited attempt is not stored, so its retry is a
  real new attempt.

### Router

- **Preview Route**: see which model a request would go to, its score, the reason, the estimated cost and the
  fallbacks, without sending the request.
- **Get Usage**: this month's routed requests, allowance, credits and the key's budget.
- **Send Feedback**: rate an answer as good or bad, by its request ID (the `requestId` output of Send Message).
- **List Models**: the routing modes and the models you can pin.

### Benchmark

All operations read the Data API. Where a period applies, the default is the last 24 hours.

- **Get Leaderboard**: ranked model scores, by period and by combined, coding, reasoning, tool use, speed or price.
  **Simplify Output** returns position, ID, name, provider, score, confidence interval, trend and status.
- **Get Model**: one model's details.
- **Get Model History**: a model's score history.
- **Get Drift Signature**: a model's drift status: regime, change-point detector state and per-axis trends.
- **Get Incidents**: detected incidents, newest first.
- **Get Alerts**: current performance alerts.
- **Get Recommendations**: the recommended model per category (for example best for code, most reliable, best value).
- **Get Degradations**: models whose scores have dropped.
- **Get Provider Reliability**: reliability figures per provider.
- **Get Provider Status**: current status and response time of each provider.
- **Get Global Index**: the fleet-wide score index and its recent history.

Model operations take the numeric model ID (the `id` field of **Get Leaderboard**, for example `292`), not the model
name.

Like other n8n nodes, the node runs once per input item. With the free Data API tier (1 request a minute), turn on
**Execute Once** in the node settings when the input has more than one item.

## AI Stupid Level Chat Model

Connect **AI Stupid Level Chat Model** to the **Chat Model** input of an **AI Agent**, **Basic LLM Chain** or other
root node that takes a chat model. Every call the agent makes, including tool-calling turns, goes through the router.

- **Routing Mode**: the same modes as above. The default is **Best for Tool Use**, which suits agents that call tools.
  **Pin a Model** keeps one model.
- **Options**: Sampling Temperature, Maximum Tokens, Reasoning Effort, Timeout, Max Retries and Sandbox.

The sub-node is built with n8n's AI node SDK (`@n8n/ai-node-sdk`), which n8n provides at runtime.

## Usage

### Route a support ticket summary to the best-value model

1. **Trigger** (for example a webhook with a ticket).
2. **AI Stupid Level** → Chat → Send Message, Routing Mode **Best Value**, Prompt
   `Summarize this ticket in two sentences: {{ $json.body }}`.
3. Use `{{ $json.answer }}` downstream. `{{ $json.model }}` and `{{ $json.routingReason }}` record which model answered
   and why.

### Agent with tools

1. **When chat message received** → **AI Agent**.
2. Attach **AI Stupid Level Chat Model** (Routing Mode **Best for Tool Use**) to the agent's Chat Model input.
3. Attach your tools.

### Alert when a model you use degrades

1. **Schedule Trigger** (for example every hour).
2. **AI Stupid Level** → Benchmark → Get Incidents (Limit 5).
3. **Filter** on `{{ $json.detectedAt }}` and the models you use, then notify (Slack, email).

## Compatibility

- Built with `@n8n/node-cli` 0.51.3 and tested on n8n 2.42.3 (Node.js 24).
- The **AI Stupid Level Chat Model** needs an n8n version that provides `@n8n/ai-node-sdk` (AI node SDK version 1).
- The **AI Stupid Level** node uses only `n8n-workflow`.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Smart Router documentation](https://aistupidlevel.info/router/docs)
- [Router OpenAPI description](https://aistupidlevel.info/v1/openapi.json)
- [Data API documentation](https://aistupidlevel.info/api-docs)
- [AI Stupid Level methodology](https://aistupidlevel.info/methodology)

## Version history

### 0.1.0

First release: the AI Stupid Level node (Chat, Router and Benchmark resources) and the AI Stupid Level Chat Model
sub-node.
