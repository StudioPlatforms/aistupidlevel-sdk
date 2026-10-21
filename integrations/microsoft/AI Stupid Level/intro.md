# AI Stupid Level

AI Stupid Level runs coding, reasoning and tool-use benchmarks on the leading AI models and ranks them. Its Smart Router is an OpenAI-compatible endpoint that uses those rankings: you choose a routing mode such as best for coding or best value, and each request goes to the model that scores best for that mode among the providers you have connected. The router calls that model with your own provider keys and adds nothing to token prices.

## Publisher: S.C. Studio Platforms S.R.L.

## Prerequisites

- An AI Stupid Level account. A free account includes 1,000 routed requests a month: https://aistupidlevel.info
- A router key, which starts with `aism_`, from https://aistupidlevel.info/router/keys
- At least one provider key (OpenAI, Anthropic, Google, DeepSeek, Kimi or GLM) saved in the router settings on the same site. Without one, use the Sandbox option to test: the routing is real and the answer is a mock, so nothing is spent.

## Supported Operations

### Send a prompt
Sends a conversation to the model that scores best for the routing mode and returns the answer. The response headers name the model and provider that answered and why the router chose them.

### Preview the route
Shows which model the router would pick for a conversation, with its score, estimated cost and fallback models. Nothing is sent to a model or counted against the plan.

### Get usage for this month
Returns the routed requests used and left this month. The call is free.

## Obtaining Credentials

1. Sign up or sign in at https://aistupidlevel.info.
2. Open https://aistupidlevel.info/router/keys and create a router key.
3. Add your provider keys in the router settings.
4. When you create the connection, paste the router key. The connector sends it as `Authorization: Bearer <key>`.

## Getting Started

1. Add the **Send a prompt** action to a flow.
2. Choose a routing mode, for example `auto-coding` for code, `auto-reasoning` for analysis, `auto-tooling` for agents or `auto-value` for the best score per dollar. You can also choose a model ID to pin one model.
3. Add a user message with your prompt, and optionally a system message with instructions.
4. Use **Answer** from the first choice in later steps.

Documentation for the routing modes: https://aistupidlevel.info/router/docs

## Known Issues and Limitations

- Text only: image and audio input are not supported.
- The longest answer is 64,000 tokens, the smallest output limit among the models the router can pick.
- Each routed request counts against the monthly allowance of your AI Stupid Level plan, and the provider bills the tokens to your provider account.

## Deployment Instructions

Use the [Microsoft Power Platform Connectors CLI](https://learn.microsoft.com/connectors/custom-connectors/paconn-cli) to create the connector from `apiDefinition.swagger.json` and `apiProperties.json`, then create a connection with your router key.

## Support

Email hello@aistupidlevel.info or see https://aistupidlevel.info/router/docs.
