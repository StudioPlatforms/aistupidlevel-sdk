const { ROUTER_URL } = require('../lib/constants');
const { chatBody, promptFields } = require('../lib/chat');

const perform = async (z, bundle) => {
  const response = await z.request({
    url: `${ROUTER_URL}/chat/completions`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: chatBody(bundle.inputData),
  });
  const j = response.data;
  const choice = (j.choices && j.choices[0]) || {};
  const usage = j.usage || {};
  return {
    id: j.id,
    answer: (choice.message && choice.message.content) || '',
    finish_reason: choice.finish_reason || null,
    model: response.getHeader('x-aism-model') || j.model,
    provider: response.getHeader('x-aism-provider') || null,
    why: response.getHeader('x-aism-reasoning') || null,
    latency_ms: Number(response.getHeader('x-aism-latency')) || null,
    sandbox: response.getHeader('x-aism-sandbox') === 'true',
    routing_mode: bundle.inputData.mode || 'auto-best',
    prompt_tokens: usage.prompt_tokens || 0,
    completion_tokens: usage.completion_tokens || 0,
    total_tokens: usage.total_tokens || 0,
  };
};

module.exports = {
  key: 'send_prompt',
  noun: 'Answer',
  display: {
    label: 'Send Prompt',
    description: 'Sends a prompt through the Smart Router, which picks the model that scores best for the routing mode, and returns the answer and which model gave it.',
  },
  operation: {
    perform,
    inputFields: [
      ...promptFields,
      { key: 'max_tokens', label: 'Max output tokens', type: 'integer', required: false, helpText: 'Upper limit on the answer length, up to 64,000.' },
      { key: 'temperature', label: 'Temperature', type: 'number', required: false, helpText: '0 to 2. Leave empty for the model default.' },
      {
        key: 'reasoning_effort', label: 'Reasoning effort', required: false,
        choices: { none: 'None', low: 'Low', medium: 'Medium', high: 'High', max: 'Max' },
        helpText: 'For models that reason. The router maps it to the closest level each model supports.',
      },
    ],
    sample: {
      id: 'chatcmpl-mvhsp3qa3gna0z5v',
      answer: 'def reverse(s: str) -> str:\n    return s[::-1]',
      finish_reason: 'stop',
      model: 'claude-opus-5-5',
      provider: 'anthropic',
      why: 'Selected claude-opus-5-5 from anthropic for best coding performance. Ranked #1 of 24 available models.',
      latency_ms: 1420,
      sandbox: false,
      routing_mode: 'auto-coding',
      prompt_tokens: 18,
      completion_tokens: 22,
      total_tokens: 40,
    },
    outputFields: [
      { key: 'answer', label: 'Answer' },
      { key: 'model', label: 'Model that answered' },
      { key: 'provider', label: 'Provider' },
      { key: 'why', label: 'Why this model' },
      { key: 'routing_mode', label: 'Routing mode' },
      { key: 'finish_reason', label: 'Finish reason' },
      { key: 'latency_ms', label: 'Latency (ms)', type: 'integer' },
      { key: 'total_tokens', label: 'Total tokens', type: 'integer' },
      { key: 'sandbox', label: 'Sandbox', type: 'boolean' },
    ],
  },
};
