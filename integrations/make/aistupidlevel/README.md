# AI Stupid Level for Make

A Make custom app for the [AI Stupid Level](https://aistupidlevel.info/router) Smart Router.

| Module | Type | What it does |
|---|---|---|
| Send a Prompt | Action | Sends a conversation to the model that scores best for the routing mode and returns the answer, the model and provider that gave it, and why it was chosen |
| Preview a Route | Action | Shows which model the router would pick, with its score, estimated cost and fallbacks. Nothing is sent to a model or counted |
| Search the Leaderboard | Search | The top models on the combined, coding, reasoning or tool-use leaderboard (needs a Data API key) |

**Connection:** a router key (`aism_…`), a mode (**Live**, or **Sandbox** for real routing with mock answers and nothing spent), and optionally a Data API key (`asl_live_…`).

The app is kept as files: `base.iml.json`, `connection.json`, `modules/`, `rpcs/` and `groups.json`. Push them to Make with:

```sh
MAKE_API_TOKEN=... MAKE_ZONE=eu1 node deploy.mjs   # token scopes: sdk-apps:read, sdk-apps:write
```

MIT licence.
