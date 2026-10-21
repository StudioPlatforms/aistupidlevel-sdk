import aistupidlevel from "../../aistupidlevel.app.mjs";

export default {
  key: "aistupidlevel-preview-route",
  name: "Preview Route",
  description: "Show which model the Smart Router would pick for a prompt, with its score, estimated cost and fallbacks. Nothing is sent to a model or counted. [See the documentation](https://aistupidlevel.info/router/docs)",
  version: "0.0.1",
  annotations: {
    destructiveHint: false,
    openWorldHint: true,
    readOnlyHint: true,
  },
  type: "action",
  props: {
    aistupidlevel,
    model: { propDefinition: [aistupidlevel, "model"] },
    prompt: { propDefinition: [aistupidlevel, "prompt"] },
    instructions: { propDefinition: [aistupidlevel, "instructions"] },
    sandbox: { propDefinition: [aistupidlevel, "sandbox"] },
  },
  async run({ $ }) {
    const response = await this.aistupidlevel.previewRoute({
      $,
      sandbox: this.sandbox,
      data: {
        model: this.model,
        messages: this.aistupidlevel.buildMessages(this.prompt, this.instructions),
      },
    });
    $.export("$summary", `The router would pick ${response.primary?.model}`);
    return response;
  },
};
