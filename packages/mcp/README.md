# @aistupidlevel/mcp

An [MCP](https://modelcontextprotocol.io) server for [AI Stupid Level](https://aistupidlevel.info) (ASL).
It lets Claude, Cursor, VS Code or any other MCP client read ASL's LLM leaderboard, score history,
drift status, incidents and provider status. With a router key it can also ask the
[ASL Smart Router](https://aistupidlevel.info/router) which model it would pick for a prompt, or
send the prompt through the router.

Ask your assistant things like:

- "Which model is best for coding right now, according to AI Stupid Level?"
- "Has Claude Opus 5.5 got worse this week?"
- "Were there any provider incidents in the last few days?"
- "Which model would the Smart Router pick for this prompt, and why?"

It runs locally over stdio and needs Node.js 18 or later.

## Keys

The tools use two different keys, and you only need the one for the tools you want.

| Key | Used by | Where to get it |
|---|---|---|
| `ASL_DATA_KEY` (`asl_live_…`) | leaderboard, model, history, drift, incidents, providers, recommendations, global index | <https://aistupidlevel.info/account/data-keys> (free tier available) |
| `ASL_ROUTER_KEY` (`aism_…`) | `preview_route`, `ask_router`, router usage | <https://aistupidlevel.info/router/keys>, plus at least one provider key in your account |

A tool whose key is missing does not fail the server. It answers with a message that says which
key it needs and where to create it.

`ASL_API_KEY` is also accepted: it is used as the data key if it starts with `asl_`, and as the router
key if it starts with `aism_`.

### Free-tier limits

A free Data API key allows **10 requests a day and 1 a minute**. Paid plans allow 10,000 a day or more
([pricing](https://aistupidlevel.info/pricing)). The free tier is meant for trying the API, so the
server is careful with it:

- Every answer is cached in memory for 15 minutes (`ASL_CACHE_TTL`). Asking the same question again,
  or for another vendor or a shorter list from the same leaderboard, makes no request, and model
  names are looked up in the cached leaderboard.
- One tool call makes at most one Data API request. The exception is a model given by name before
  any leaderboard has been fetched, which takes one extra request to look up the model ids.
- Once the daily quota is used up, the server stops sending requests until 00:00 UTC. A request
  refused for quota still counts against it.
- If a fresh answer cannot be fetched, the server returns the last cached answer (up to 24 hours old)
  and says how old it is.
- Every answer ends with the number of requests left today.

On a free key, calling several different data tools within a minute hits the per-minute limit. The
tool then says when to try again. If the wait is 15 seconds or less (`ASL_MAX_WAIT`), the server waits
and retries once by itself.

The newest-run view (`period: "latest"`) needs a paid key. Free keys read the 24-hour, 7-day and
30-day views.

`preview_route` and `get_usage` are not counted against your Smart Router plan. `ask_router` is a
real routed request: the router calls the model with your own provider key, so the provider bills
you and the request counts against your plan. Pass `sandbox: true`, or set `ASL_SANDBOX=true`, to get
mock answers from the real routing at no cost.

## Install

The package runs with `npx`, so there is nothing to install first. Put your keys in place of the
placeholders, and leave out any key you do not have.

### Claude Code

```sh
claude mcp add aistupidlevel -e ASL_DATA_KEY=asl_live_... -e ASL_ROUTER_KEY=aism_... -- npx -y @aistupidlevel/mcp
```

Add `-s user` to make it available in every project.

### Claude Desktop

Settings → Developer → Edit Config, then add the server to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aistupidlevel": {
      "command": "npx",
      "args": ["-y", "@aistupidlevel/mcp"],
      "env": {
        "ASL_DATA_KEY": "asl_live_...",
        "ASL_ROUTER_KEY": "aism_..."
      }
    }
  }
}
```

Restart Claude Desktop afterwards.

### Cursor

Add the following to `~/.cursor/mcp.json` (for all projects) or `.cursor/mcp.json` (for one project):

```json
{
  "mcpServers": {
    "aistupidlevel": {
      "command": "npx",
      "args": ["-y", "@aistupidlevel/mcp"],
      "env": {
        "ASL_DATA_KEY": "asl_live_...",
        "ASL_ROUTER_KEY": "aism_..."
      }
    }
  }
}
```

### VS Code

Add the following to `.vscode/mcp.json` (or to your user configuration with **MCP: Open User
Configuration**). VS Code prompts for the keys and stores them securely:

```json
{
  "inputs": [
    { "type": "promptString", "id": "asl-data-key", "description": "AI Stupid Level Data API key (asl_live_...)", "password": true },
    { "type": "promptString", "id": "asl-router-key", "description": "AI Stupid Level router key (aism_...)", "password": true }
  ],
  "servers": {
    "aistupidlevel": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@aistupidlevel/mcp"],
      "env": {
        "ASL_DATA_KEY": "${input:asl-data-key}",
        "ASL_ROUTER_KEY": "${input:asl-router-key}"
      }
    }
  }
}
```

### Other clients

Any client that can start a stdio server can run it: the command is `npx -y @aistupidlevel/mcp`,
and the keys go in the environment variables listed under [Configuration](#configuration).

### Docker

The image builds the server from source. From the repository root:

```sh
docker build -f packages/mcp/Dockerfile -t aistupidlevel-mcp .
docker run -i --rm -e ASL_DATA_KEY=asl_live_... -e ASL_ROUTER_KEY=aism_... aistupidlevel-mcp
```

## Tools

All tools except `ask_router` are read-only.

| Tool | Key | What it returns |
|---|---|---|
| `get_leaderboard` | data | Tracked models ranked by combined, coding, reasoning or tool-use score, or by score per list-price dollar. Each row has the score, trend, status and stability, and the model ids the other tools take. Filter by vendor; choose the view (24h, 7d, 1m, or latest on a paid key). |
| `get_model` | data | One model's details: vendor, version, notes, tool-calling support and days tracked. |
| `get_model_history` | data | One model's score for each run in the window, with a summary and the per-axis results of the newest run. |
| `get_drift_status` | data | One model's drift signature: regime, current score against its baseline, the change-point detector for each suite, the last significant change, and which axes moved. |
| `get_incidents` | data | Recent incidents (provider-wide and per model) with severity, the models affected, when each was detected and when it was resolved. |
| `get_provider_status` | data | Each provider's API status from ASL's health probes, with the probe's response time and the last error. |
| `get_recommendations` | data | ASL's current picks (best for coding, most reliable, fastest, best value, poor value, avoid now), each with its reason and the evidence behind it. |
| `get_global_index` | data | ASL's global index across the tracked models, now and over the last 24 hours. |
| `preview_route` | router | The model the Smart Router would pick for a prompt, its score and estimated cost, the reason, and the fallback chain. Nothing is called or counted. |
| `ask_router` | router | Sends a prompt through the Smart Router and returns the answer, the model and provider that answered, why it was chosen, the latency and the tokens used. Set `sandbox: true` for a mock answer at no cost. |
| `get_usage` | either | This month's router usage and budget, and the Data API requests left today. |

Models can be given by numeric id, by name (`claude-opus-5-5`) or by display name (`Claude Opus 5.5`).

`preview_route` and `ask_router` take a routing `mode` (`auto`, `auto-best`, `auto-coding`,
`auto-reasoning`, `auto-tooling`, `auto-task`, `auto-value`, `auto-value-coding`,
`auto-value-reasoning`, `auto-value-tooling`, `auto-fastest-quality`, `auto-consistent`,
`auto-fastest`, `auto-cheapest`), or `pin_model` to name a model directly. The
[router documentation](https://aistupidlevel.info/router/docs#strategies) explains each mode.

The server also provides one prompt, `choose_model`, which walks the assistant through choosing a
model for a task you describe.

Answers from the Data API end with a source line. The data is licensed with attribution required:
cite aistupidlevel.info when you republish it.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ASL_DATA_KEY` | none | Data API key (`asl_live_…`) |
| `ASL_ROUTER_KEY` | none | Smart Router key (`aism_…`) |
| `ASL_SANDBOX` | `false` | `true` puts every Smart Router call in sandbox mode: real routing, mock answer, nothing spent or counted |
| `ASL_CACHE_TTL` | `900` | Seconds a Data API answer is reused |
| `ASL_MAX_WAIT` | `15` | When the per-minute limit asks for a wait this short (seconds) or shorter, wait and retry once. `0` turns this off |
| `ASL_TIMEOUT_MS` | `300000` | Timeout for a Smart Router request |

Keys are never logged. The server writes its diagnostics to stderr, because stdout carries the MCP
protocol.

## Use as a library

```ts
import { createServer } from '@aistupidlevel/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = createServer({ dataKey: process.env.ASL_DATA_KEY, cacheTtlSeconds: 600 });
await server.connect(new StdioServerTransport());
```

`createServer` accepts the same settings as the environment variables, plus a custom `fetch`.

## Development

```sh
npm ci && npm run build && npm test
```

The unit tests start the server in-process, connect an MCP client to it over an in-memory transport,
and replay real API responses from `test/fixtures`. The live tests are skipped unless keys are set:

```sh
ASL_ROUTER_KEY=aism_... npm test    # Smart Router, sandbox only: nothing is spent or counted
ASL_DATA_KEY=asl_live_... npm test  # Data API: one request
```

## Links

- [Data API documentation](https://aistupidlevel.info/api-docs)
- [Smart Router documentation](https://aistupidlevel.info/router/docs)
- [TypeScript SDK for the router](https://www.npmjs.com/package/@aistupidlevel/router)
- [Leaderboard](https://aistupidlevel.info)

MIT licence.
