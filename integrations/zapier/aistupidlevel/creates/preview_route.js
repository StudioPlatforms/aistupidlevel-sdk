const { ROUTER_URL } = require('../lib/constants');
const { chatBody, promptFields } = require('../lib/chat');

const perform = async (z, bundle) => {
  const response = await z.request({
    url: `${ROUTER_URL}/route/preview`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: chatBody(bundle.inputData),
  });
  const j = response.data;
  const p = j.primary || {};
  return {
    id: `${j.requested_model}:${p.model}`,
    routing_mode: j.requested_model,
    strategy: j.strategy,
    model: p.model,
    provider: p.provider,
    score: p.score,
    why: p.reasoning,
    estimated_cost_usd: p.estimated_cost_usd,
    fallbacks: (j.fallbacks || []).map(f => f.model).join(', '),
    fallback_enabled: !!j.fallback_enabled,
  };
};

module.exports = {
  key: 'preview_route',
  noun: 'Route',
  display: {
    label: 'Preview Route',
    description: 'Shows which model the Smart Router would pick for a prompt, with its score, estimated cost and fallbacks. Nothing is sent to a model or counted.',
  },
  operation: {
    perform,
    inputFields: promptFields,
    sample: {
      id: 'auto-coding:claude-opus-5-5',
      routing_mode: 'auto-coding',
      strategy: 'best_coding',
      model: 'claude-opus-5-5',
      provider: 'anthropic',
      score: 99,
      why: 'Selected claude-opus-5-5 from anthropic for best coding performance. Ranked #1 of 24 available models.',
      estimated_cost_usd: 0.012,
      fallbacks: 'deepseek-v4-flash, gpt-5.6-luna',
      fallback_enabled: true,
    },
    outputFields: [
      { key: 'model', label: 'Model it would pick' },
      { key: 'provider', label: 'Provider' },
      { key: 'score', label: 'Score', type: 'number' },
      { key: 'why', label: 'Why this model' },
      { key: 'estimated_cost_usd', label: 'Estimated cost (USD)', type: 'number' },
      { key: 'fallbacks', label: 'Fallback models' },
    ],
  },
};
