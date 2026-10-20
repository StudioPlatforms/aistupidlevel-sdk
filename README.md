# AI Stupid Level SDKs

Official clients for the [AI Stupid Level Smart Router](https://aistupidlevel.info/router), an
OpenAI-compatible endpoint. Each request goes to the model measuring best for that kind of work,
based on benchmarks that are re-run continuously. You call it with your own provider keys.

| Package | Install | Source |
|---|---|---|
| TypeScript / JavaScript | `npm install @aistupidlevel/router` | [packages/router](packages/router) |
| Python | `pip install aistupidlevel` | [python](python) |
| Vercel AI SDK provider | `npm install @aistupidlevel/ai-sdk-provider` | [packages/ai-sdk-provider](packages/ai-sdk-provider) |
| MCP server (Claude, Cursor, VS Code, …) | `npx -y @aistupidlevel/mcp` | [packages/mcp](packages/mcp) |
| n8n community node | Settings → Community Nodes → `n8n-nodes-aistupidlevel` | [packages/n8n-nodes-aistupidlevel](packages/n8n-nodes-aistupidlevel) |
| Raycast extension | Raycast Store (in review) | [integrations/raycast/aistupidlevel](integrations/raycast/aistupidlevel) |
| Hermes Agent provider plugin | `hermes plugins install aistupidlevel` | [integrations/hermes/aistupidlevel](integrations/hermes/aistupidlevel) |
| OpenClaw provider plugin | `openclaw plugins install npm:@aistupidlevel/openclaw-provider` | [packages/openclaw-provider](packages/openclaw-provider) |

[`openapi/router-v1.json`](openapi/router-v1.json) describes the API in OpenAPI 3.1, for generating a
client in any other language. The live copy is at <https://aistupidlevel.info/v1/openapi.json>.

## Quick start

```ts
import { ASLRouter } from '@aistupidlevel/router';

const router = new ASLRouter(); // ASL_ROUTER_KEY
const r = await router.chat.completions.create({ model: 'auto-coding', messages: [{ role: 'user', content: 'Fix this bug: ...' }] });
console.log(r.choices[0].message.content, r.routing.model, r.routing.reasoning);
```

```python
from aistupidlevel import ASLRouter

router = ASLRouter()  # ASL_ROUTER_KEY
r = router.chat.completions.create(model="auto-coding", messages=[{"role": "user", "content": "Fix this bug: ..."}])
print(r.choices[0].message.content, r.routing.model, r.routing.reasoning)
```

## Why use an SDK instead of an OpenAI client

Any OpenAI client works against `https://aistupidlevel.info/v1`. The SDKs add:

- **Routing info** on every answer and stream: the model and provider that answered, why they were
  chosen, and whether a fallback answered.
- **Safe retries.** An automatic `Idempotency-Key` means a request is answered once, even if it is
  retried.
- **Typed errors** with `party` and `retryable`. An app can tell its user to top up, to fix a
  provider key, or simply to try again.
- `runTools` / `run_tools`, a tool-calling loop that stays on one model.
- **Sandbox mode** (mock answers through real routing, at no cost), route previews, and usage.

See the [API documentation](https://aistupidlevel.info/router/docs#sdks).

## Development

```sh
# TypeScript (the router package runs on Node 18+; the AI SDK provider needs Node 22+)
cd packages/router && npm ci && npm run build && npm test
cd packages/ai-sdk-provider && npm ci && npm run build && npm test
cd packages/mcp && npm ci && npm run build && npm test
cd packages/openclaw-provider && npm ci && npm test   # Node 24.16+, like OpenClaw
cd packages/n8n-nodes-aistupidlevel && npm ci && npm run build && npm run lint && npm test

# Python
cd python && pip install -e . && python -m unittest discover -s tests
```

The live tests run against the real router in sandbox mode, so nothing is spent. They need a router
key and are skipped without one:

```sh
ASL_ROUTER_KEY=aism_... npm test
ASL_ROUTER_KEY=aism_... python -m unittest discover -s tests
```

## Releasing

1. Bump the version in every place it appears:
   - `packages/router/package.json` and `packages/router/src/core.ts`;
   - `packages/ai-sdk-provider/package.json` and `packages/ai-sdk-provider/src/index.ts`;
   - `packages/mcp/package.json`, `packages/mcp/src/config.ts` and both versions in `packages/mcp/server.json`;
   - `python/src/aistupidlevel/_version.py`.
2. npm: `npm publish --access public` in each package directory. `prepublishOnly` builds the package
   and runs its tests first.
3. PyPI: `cd python && python -m build && twine upload dist/*`.
4. MCP Registry, after the npm release of `@aistupidlevel/mcp`: `cd packages/mcp && mcp-publisher login github && mcp-publisher publish`.
5. n8n node: n8n accepts only npm releases with provenance, so it is published by
   [`.github/workflows/n8n-publish.yml`](.github/workflows/n8n-publish.yml). Bump
   `packages/n8n-nodes-aistupidlevel/package.json` and its `CHANGELOG.md`, then push a tag `n8n-v<version>`.
6. Raycast: from `integrations/raycast/aistupidlevel`, `npm run publish` opens a pull request to
   raycast/extensions.

## Licence

MIT
