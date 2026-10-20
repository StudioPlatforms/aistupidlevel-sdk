import { AI, getPreferenceValues } from "@raycast/api";
import { ROUTING_MODES } from "./lib/constants";
import { toOpenAIMessages, toOpenAITools, toStreamParts } from "./lib/provider";
import { openChatStream } from "./lib/router";

/**
 * Smart Router routing modes as models in Raycast AI (AI Chat, Quick AI, AI Commands).
 * Each request is routed to the model scoring best for it, using the provider keys on the
 * user's AI Stupid Level account.
 */
export const getModels: AI.GetModels = () => {
  const { sandbox } = getPreferenceValues<Preferences>();
  return ROUTING_MODES.map((mode) => ({
    id: mode.id,
    title: `Smart Router: ${mode.title}`,
    description: sandbox ? `${mode.description} Sandbox mode: answers are mock text.` : mode.description,
    capabilities: {
      systemMessage: { supported: true },
      temperature: { supported: false },
      streaming: { supported: true },
      tools: { supported: true },
    },
  }));
};

export const streamCompletion: AI.StreamCompletion = async function* (model, request) {
  const { routerKey, sandbox } = getPreferenceValues<Preferences>();
  const tools = toOpenAITools(request.tools);
  const body: Record<string, unknown> = {
    model: model.id,
    messages: toOpenAIMessages(request),
    stream_options: { include_usage: true },
  };
  if (tools) {
    body.tools = tools;
    if (request.toolChoice) body.tool_choice = request.toolChoice;
  }
  const { chunks } = await openChatStream(body, { apiKey: routerKey, sandbox });
  yield* toStreamParts(chunks);
};
