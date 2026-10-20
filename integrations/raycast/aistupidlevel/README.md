# AI Stupid Level

Check the AI Stupid Level leaderboard, drift status and incidents from Raycast, and send prompts through the AI Stupid Level Smart Router.

[AI Stupid Level](https://aistupidlevel.info) publishes coding, reasoning and tool-use scores for the major AI models and watches them for drift. Its Smart Router is an OpenAI-compatible API that sends each request to the model scoring best for that kind of work, using your own provider keys (OpenAI, Anthropic, Google, DeepSeek, Moonshot AI, Z.ai).

## Commands

### Model Leaderboard

Models ranked by score on the Combined, Coding, Reasoning or Tool Use leaderboard (pick one in the search bar). Models with the same published score share a rank, shown as `=3`.

- **Change Period…** switches between the last 24 hours, 7 days and 30 days. The newest single run is available on paid plans.
- **Show Score History** opens the model's recent runs, a sparkline and the scoring axes of its newest run.
- **Show Drift Status** shows where each suite's change detector stands.
- **Ask Smart Router with This Model** opens Ask Smart Router with the request pinned to that model.

### Model Incidents

Active and recently resolved incidents: performance drift, service disruptions and provider-wide degradations, with when each was detected and resolved.

### Ask Smart Router

Type a prompt, choose a routing mode and read the answer as it streams. The side panel shows which model answered, its provider, and the router's reason for choosing it.

- Type a prompt straight after the command name in Raycast to get an answer with your default routing mode.
- **Preview Route** shows which model would answer and the fallbacks, without sending anything to a provider.
- **Ask a Follow-Up** continues the conversation.

| Routing mode | Picks |
| --- | --- |
| Best Overall (`auto-best`) | the highest combined score |
| Coding, Reasoning, Tool Use | the top model on that leaderboard |
| Match the Task (`auto-task`) | the leaderboard that matches the request |
| Best Value (`auto-value`), Best Value for Coding | the most points per measured dollar, among models within 5 points of the best |
| Fastest Near the Top (`auto-fastest-quality`) | the fastest model within 5 points of the best |
| My Saved Strategy (`auto`) | the strategy saved on your AI Stupid Level account |

### Smart Router models in Raycast AI

With a Raycast Pro plan, the routing modes also appear as models in AI Chat, Quick AI and AI Commands (look for "Smart Router" in the model picker). They support system instructions, streaming and AI Extensions (tool calls).

## Setup

The extension has two optional keys. Add the one for the commands you use in the extension preferences.

| Preference | Used by | Where to get it |
| --- | --- | --- |
| Data API Key (`asl_live_…`) | Model Leaderboard, Model Incidents | [aistupidlevel.info/account/data-keys](https://aistupidlevel.info/account/data-keys), free |
| Smart Router Key (`aism_…`) | Ask Smart Router, Smart Router models in Raycast AI | [aistupidlevel.info/router/keys](https://aistupidlevel.info/router/keys) |

The Smart Router answers with your own provider keys. Add at least one at [aistupidlevel.info/router/providers](https://aistupidlevel.info/router/providers). Provider usage is billed by each provider to your own account.

**Sandbox Mode** routes requests for real but answers with a placeholder, so no provider is called and nothing is charged. Use it to try the extension.

### Free Data API key limits

A free Data API key allows 10 requests a day and 1 per minute. To stay within that, the extension:

- makes one request per screen and keeps each answer for 15 minutes before asking again;
- shows the last saved answer, with a notice, if a refresh is refused;
- shows how many requests are left today under each list.

The **Refresh** action asks again straight away. [Paid plans](https://aistupidlevel.info/pricing) raise the limits.

## Privacy

- Keys are stored in Raycast's preferences and sent only to `aistupidlevel.info`.
- Prompts in Ask Smart Router and in the Smart Router models go to `aistupidlevel.info/v1`, which forwards them to the chosen model's provider using your provider key. See the [privacy policy](https://aistupidlevel.info/privacy).
- Data API answers are kept in Raycast's local cache for the extension.

## Links

- [Data API documentation](https://aistupidlevel.info/api-docs)
- [Smart Router documentation](https://aistupidlevel.info/router/docs)
- [Status page](https://aistupidlevel.info/status)
