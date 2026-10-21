const ROUTER_URL = 'https://aistupidlevel.info/v1';
const DATA_URL = 'https://aistupidlevel.info/api/v1';

/** Readable names for the routing modes GET /v1/models lists. Any other id pins that model. */
const MODE_LABELS = {
  'auto': 'Automatic (balanced)',
  'auto-best': 'Best overall',
  'auto-coding': 'Best for coding',
  'auto-reasoning': 'Best for reasoning',
  'auto-tooling': 'Best for tool use',
  'auto-task': 'Matched to each request',
  'auto-value': 'Best value',
  'auto-value-coding': 'Best value for coding',
  'auto-value-reasoning': 'Best value for reasoning',
  'auto-value-tooling': 'Best value for tool use',
  'auto-fastest-quality': 'Fastest among the strong models',
  'auto-fastest': 'Fastest',
  'auto-cheapest': 'Cheapest',
  'auto-consistent': 'Most consistent',
  'auto-split': 'Custom split',
};

module.exports = { ROUTER_URL, DATA_URL, MODE_LABELS };
