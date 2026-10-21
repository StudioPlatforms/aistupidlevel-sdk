const { ROUTER_URL, MODE_LABELS } = require('../lib/constants');

// Hidden: fills the Routing mode dropdown from GET /v1/models (routing modes first, then models to pin).
const perform = async (z, bundle) => {
  const response = await z.request({ url: `${ROUTER_URL}/models` });
  const ids = (response.data.data || []).map(m => m.id);
  const modes = ids.filter(id => id.startsWith('auto'));
  const pins = ids.filter(id => !id.startsWith('auto'));
  return [
    ...modes.map(id => ({ id, name: `${MODE_LABELS[id] || id} (${id})` })),
    ...pins.map(id => ({ id, name: `Pin ${id}` })),
  ];
};

module.exports = {
  key: 'routing_modes',
  noun: 'Routing mode',
  display: { label: 'Routing Modes', description: 'Lists the routing modes and models for dropdowns.', hidden: true },
  operation: { perform, sample: { id: 'auto-coding', name: 'Best for coding (auto-coding)' } },
};
