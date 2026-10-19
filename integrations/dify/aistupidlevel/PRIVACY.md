# Privacy

This plugin sends requests only to the AI Stupid Level Smart Router at `https://aistupidlevel.info/v1`. It has no other remote endpoint and no server of its own.

Each request can include the model or routing mode, prompts, conversation messages, tool definitions and request parameters. Your router key is sent as a `Bearer` token in the `Authorization` header. Responses, token usage and errors go back to Dify. When you save the key, the plugin checks it with `GET /v1/usage`, which sends no prompt.

The plugin itself stores nothing and adds no analytics or telemetry.

AI Stupid Level passes each request to the AI provider it routes to (OpenAI, Anthropic, Google, DeepSeek, Moonshot or Zhipu), using the provider keys you added to your AI Stupid Level account; that provider processes it under its own terms. AI Stupid Level does not store prompts unless you turn on prompt logging in your account. Its handling of your data is described in the [AI Stupid Level privacy policy](https://aistupidlevel.info/privacy).
