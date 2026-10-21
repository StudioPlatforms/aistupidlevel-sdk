# AI Stupid Level for Zapier

A Zapier integration for the [AI Stupid Level](https://aistupidlevel.info/router) Smart Router.

| Type | Name | What it does |
|---|---|---|
| Action | Send Prompt | Sends a prompt to the model that scores best for the routing mode and returns the answer, the model and provider that gave it, and why it was chosen |
| Action | Preview Route | Shows which model the router would pick, with its score, estimated cost and fallbacks. Nothing is sent to a model or counted |
| Search | Find Leaderboard | The top models on the combined, coding, reasoning or tool-use leaderboard (needs a Data API key) |

**Connection:** a router key (`aism_…`, from https://aistupidlevel.info/router/keys), a mode (**Live**, or **Sandbox** for real routing with mock answers and nothing spent), and optionally a Data API key (`asl_live_…`) for the leaderboard search.

## Development

```sh
npm install
ASL_ROUTER_KEY=aism_... npm test   # live tests run in sandbox mode: nothing is spent
npx zapier-platform validate
npx zapier-platform push           # needs `zapier-platform login` or ZAPIER_DEPLOY_KEY
```

MIT licence.
