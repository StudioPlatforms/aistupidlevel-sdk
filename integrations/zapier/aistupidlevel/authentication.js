const { ROUTER_URL } = require('./lib/constants');

// GET /v1/usage checks the router key. It is free: it never counts against the plan.
const test = async (z, bundle) => {
  const response = await z.request({ url: `${ROUTER_URL}/usage` });
  return response.data;
};

module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'routerKey',
      label: 'Router key',
      type: 'password',
      required: true,
      helpText: 'Your Smart Router key (it starts with `aism_`). Create one at [aistupidlevel.info/router/keys](https://aistupidlevel.info/router/keys), and add your provider keys (OpenAI, Anthropic, Google, DeepSeek, Kimi, GLM) in the router settings there.',
    },
    {
      key: 'mode',
      label: 'Mode',
      type: 'string',
      required: true,
      default: 'live',
      choices: { live: 'Live', sandbox: 'Sandbox (real routing, mock answers, nothing spent)' },
      helpText: 'Sandbox picks the model exactly as Live does but returns a mock answer, so you can build and test Zaps before adding provider keys. [About sandbox mode](https://aistupidlevel.info/router/docs#sandbox).',
    },
    {
      key: 'dataKey',
      label: 'Data API key (optional)',
      type: 'password',
      required: false,
      helpText: 'Only for the Find Leaderboard search. A Data API key starts with `asl_live_`; create a free one at [aistupidlevel.info/account/data-keys](https://aistupidlevel.info/account/data-keys).',
    },
  ],
  test,
  connectionLabel: (z, bundle) => {
    const json = bundle.inputData || {};
    const name = json.key && json.key.name ? json.key.name : 'router key';
    return `${name}${bundle.authData.mode === 'sandbox' ? ' (sandbox)' : ''}`;
  },
};
