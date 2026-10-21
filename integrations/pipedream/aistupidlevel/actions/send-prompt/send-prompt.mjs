import aistupidlevel from "../../aistupidlevel.app.mjs";

export default {
  key: "aistupidlevel-send-prompt",
  name: "Send Prompt",
  description: "Send a prompt through the Smart Router, which picks the model that scores best for the routing mode, and get the answer and which model gave it. [See the documentation](https://aistupidlevel.info/router/docs)",
  version: "0.0.1",
  annotations: {
    destructiveHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  },
  type: "action",
  props: {
    aistupidlevel,
    model: { propDefinition: [aistupidlevel, "model"] },
    prompt: { propDefinition: [aistupidlevel, "prompt"] },
    instructions: { propDefinition: [aistupidlevel, "instructions"] },
    maxTokens: {
      type: "integer",
      label: "Max Output Tokens",
      description: "Upper limit on the answer length, up to 64,000.",
      min: 1,
      max: 64000,
      optional: true,
    },
    reasoningEffort: {
      type: "string",
      label: "Reasoning Effort",
      description: "For models that reason. The router maps it to the closest level each model supports.",
      options: ["none", "low", "medium", "high", "max"],
      optional: true,
    },
    sandbox: { propDefinition: [aistupidlevel, "sandbox"] },
  },
  async run({ $ }) {
    const response = await this.aistupidlevel.sendChatCompletion({
      $,
      sandbox: this.sandbox,
      data: {
        model: this.model,
        messages: this.aistupidlevel.buildMessages(this.prompt, this.instructions),
        ...(this.maxTokens && { max_tokens: this.maxTokens }),
        ...(this.reasoningEffort && { reasoning_effort: this.reasoningEffort }),
      },
    });
    const body = response.data;
    const headers = response.headers || {};
    const result = {
      answer: body.choices?.[0]?.message?.content ?? "",
      model: headers["x-aism-model"] || body.model,
      provider: headers["x-aism-provider"],
      why: headers["x-aism-reasoning"],
      sandbox: headers["x-aism-sandbox"] === "true",
      usage: body.usage,
      id: body.id,
    };
    $.export("$summary", `Answered by ${result.model}`);
    return result;
  },
};
