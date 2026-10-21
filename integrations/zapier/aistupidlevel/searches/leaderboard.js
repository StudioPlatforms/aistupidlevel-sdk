const { DATA_URL } = require('../lib/constants');

const BOARDS = { combined: 'Combined', coding: 'Coding', reasoning: 'Reasoning', tooling: 'Tool use' };

const perform = async (z, bundle) => {
  if (!bundle.authData.dataKey) {
    throw new z.errors.Error('Find Leaderboard needs a Data API key. Add one to this connection; a free key is at https://aistupidlevel.info/account/data-keys.', 'MissingDataKey', 400);
  }
  const board = bundle.inputData.board || 'combined';
  const response = await z.request({
    url: `${DATA_URL}/models`,
    params: { sortBy: board, period: bundle.inputData.period || '24h' },
  });
  let rows = response.data.data || [];
  const vendor = (bundle.inputData.vendor || '').trim().toLowerCase();
  if (vendor) rows = rows.filter(r => String(r.vendor || r.provider).toLowerCase() === vendor);
  const limit = Math.max(1, Math.min(Number(bundle.inputData.limit) || 10, 50));
  return rows.slice(0, limit).map((r, i) => ({
    id: String(r.id),
    rank: i + 1,
    model: r.name,
    display_name: r.displayName || r.name,
    vendor: r.vendor || r.provider,
    score: r.currentScore,
    trend: r.trend,
    status: r.status,
    board: BOARDS[board],
    last_updated: r.lastUpdated,
  }));
};

module.exports = {
  key: 'leaderboard',
  noun: 'Model ranking',
  display: {
    label: 'Find Leaderboard',
    description: 'Finds the top models on an AI Stupid Level leaderboard (combined, coding, reasoning or tool use). Needs a Data API key on the connection.',
  },
  operation: {
    perform,
    inputFields: [
      { key: 'board', label: 'Leaderboard', required: true, default: 'combined', choices: BOARDS },
      { key: 'period', label: 'Period', required: false, default: '24h', choices: { '24h': 'Last 24 hours', '7d': 'Last 7 days', '1m': 'Last 30 days', latest: 'Latest run (paid Data API plans)' } },
      { key: 'vendor', label: 'Vendor', required: false, helpText: 'Only this vendor, for example `anthropic`, `openai` or `google`.' },
      { key: 'limit', label: 'How many', type: 'integer', required: false, default: '10', helpText: 'Up to 50.' },
    ],
    sample: {
      id: '292', rank: 1, model: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', vendor: 'anthropic',
      score: 95, trend: 'stable', status: 'excellent', board: 'Combined', last_updated: '2026-10-20T06:00:00.239Z',
    },
    outputFields: [
      { key: 'rank', label: 'Rank', type: 'integer' },
      { key: 'display_name', label: 'Model' },
      { key: 'model', label: 'Model id' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'score', label: 'Score', type: 'number' },
      { key: 'trend', label: 'Trend' },
      { key: 'status', label: 'Status' },
    ],
  },
};
