import { axios } from "@pipedream/platform";

export default {
  type: "app",
  app: "aistupidlevel",
  propDefinitions: {
    model: {
      type: "string",
      label: "Routing Mode",
      description: "A routing mode such as `auto-coding` or `auto-best`: each request goes to the model that scores best for it on AI Stupid Level's benchmarks, among the providers you connected. Choose a model ID to pin that model. [See the routing modes](https://aistupidlevel.info/router/docs#strategies).",
      default: "auto-best",
      async options() {
        const { data } = await this.listModels();
        return data.map(({ id }) => id);
      },
    },
    prompt: {
      type: "string",
      label: "Prompt",
      description: "The prompt to send.",
    },
    instructions: {
      type: "string",
      label: "Instructions",
      description: "Optional instructions, sent as the system message.",
      optional: true,
    },
    sandbox: {
      type: "boolean",
      label: "Sandbox",
      description: "Real routing with a mock answer: nothing is sent to a model or counted. Useful for testing before you add provider keys.",
      optional: true,
      default: false,
    },
  },
  methods: {
    _apiUrl() {
      return "https://aistupidlevel.info/v1";
    },
    _getHeaders(sandbox) {
      return {
        "Authorization": `Bearer ${this.$auth.api_key}`,
        ...(sandbox
          ? { "X-ASL-Sandbox": "true" }
          : {}),
      };
    },
    _makeRequest({
      $ = this, path, sandbox, ...opts
    }) {
      return axios($, {
        url: `${this._apiUrl()}/${path}`,
        headers: this._getHeaders(sandbox),
        ...opts,
      });
    },
    buildMessages(prompt, instructions) {
      return [
        ...(instructions
          ? [{ role: "system", content: instructions }]
          : []),
        { role: "user", content: prompt },
      ];
    },
    listModels(opts = {}) {
      return this._makeRequest({ path: "models", ...opts });
    },
    sendChatCompletion(opts = {}) {
      return this._makeRequest({ method: "POST", path: "chat/completions", returnFullResponse: true, ...opts });
    },
    previewRoute(opts = {}) {
      return this._makeRequest({ method: "POST", path: "route/preview", ...opts });
    },
    getUsage(opts = {}) {
      return this._makeRequest({ path: "usage", ...opts });
    },
  },
};
