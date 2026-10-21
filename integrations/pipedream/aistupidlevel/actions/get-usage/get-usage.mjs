import aistupidlevel from "../../aistupidlevel.app.mjs";

export default {
  key: "aistupidlevel-get-usage",
  name: "Get Usage",
  description: "Get the routed requests used and left this month. The call is free. [See the documentation](https://aistupidlevel.info/router/docs)",
  version: "0.0.1",
  annotations: {
    destructiveHint: false,
    openWorldHint: true,
    readOnlyHint: true,
  },
  type: "action",
  props: {
    aistupidlevel,
  },
  async run({ $ }) {
    const response = await this.aistupidlevel.getUsage({ $ });
    $.export("$summary", `${response.requests?.remaining ?? "Unlimited"} routed requests left this month`);
    return response;
  },
};
