/** The chat request body shared by Send Prompt and Preview Route. */
const chatBody = (input) => {
  const messages = [];
  if (input.system) messages.push({ role: 'system', content: input.system });
  messages.push({ role: 'user', content: input.prompt });
  const body = { model: input.mode || 'auto-best', messages };
  if (input.max_tokens) body.max_tokens = Number(input.max_tokens);
  if (input.temperature !== undefined && input.temperature !== null && input.temperature !== '') body.temperature = Number(input.temperature);
  if (input.reasoning_effort) body.reasoning_effort = input.reasoning_effort;
  return body;
};

const modeField = {
  key: 'mode',
  label: 'Routing mode',
  required: true,
  default: 'auto-best',
  dynamic: 'routing_modes.id.name',
  helpText: 'Each request goes to the model that scores best for this mode on AI Stupid Level\'s benchmarks, among the providers you connected. Pick a model id instead to pin that model. [About the modes](https://aistupidlevel.info/router/docs#strategies).',
};

const promptFields = [
  modeField,
  { key: 'prompt', label: 'Prompt', type: 'text', required: true },
  { key: 'system', label: 'Instructions (system message)', type: 'text', required: false },
];

module.exports = { chatBody, modeField, promptFields };
