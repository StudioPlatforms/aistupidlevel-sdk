/* Live tests use the sandbox (real routing, mock answers, nothing spent) and run when
   ASL_ROUTER_KEY is set. The Data API test replays a recorded answer. */
const zapier = require('zapier-platform-core');
const nock = require('nock');
const App = require('../index');

const appTester = zapier.createAppTester(App);
zapier.tools.env.inject();

const KEY = process.env.ASL_ROUTER_KEY;
const live = KEY ? test : test.skip;
const sandboxAuth = { routerKey: KEY, mode: 'sandbox' };

describe('AI Stupid Level', () => {
  afterEach(() => nock.cleanAll());

  live('authentication test answers with the key', async () => {
    const result = await appTester(App.authentication.test, { authData: sandboxAuth });
    expect(result.object).toBe('usage');
    expect(result.key.prefix).toBe(KEY.slice(0, 12));
  });

  live('routing modes come first in the dropdown', async () => {
    const rows = await appTester(App.triggers.routing_modes.operation.perform, { authData: sandboxAuth });
    expect(rows[0].id.startsWith('auto')).toBe(true);
    expect(rows.find(r => r.id === 'auto-coding').name).toBe('Best for coding (auto-coding)');
  });

  live('Send Prompt returns the answer and the model that gave it', async () => {
    const out = await appTester(App.creates.send_prompt.operation.perform, {
      authData: sandboxAuth,
      inputData: { mode: 'auto-coding', prompt: 'Write a Python function that reverses a string.', max_tokens: 200 },
    });
    expect(out.sandbox).toBe(true);
    expect(out.answer.length).toBeGreaterThan(0);
    expect(out.model).toBeTruthy();
    expect(out.provider).toBeTruthy();
    expect(out.why).toMatch(/Sandbox/);
  });

  live('Preview Route names a model and fallbacks', async () => {
    const out = await appTester(App.creates.preview_route.operation.perform, {
      authData: sandboxAuth,
      inputData: { mode: 'auto-tooling', prompt: 'Look up the weather in Paris and book a table.' },
    });
    expect(out.model).toBeTruthy();
    expect(typeof out.score).toBe('number');
  });

  it('a refused key says where to fix it', async () => {
    nock('https://aistupidlevel.info').get('/v1/usage').reply(401, { error: { message: 'Invalid API key' } });
    await expect(appTester(App.authentication.test, { authData: { routerKey: 'aism_bad', mode: 'live' } }))
      .rejects.toThrow(/router\/keys/);
  });

  it('Find Leaderboard filters by vendor and keeps rank order', async () => {
    const recorded = require('./fixture-models.json');
    nock('https://aistupidlevel.info').get('/api/v1/models').query({ sortBy: 'coding', period: '24h' })
      .matchHeader('authorization', 'Bearer asl_live_test').reply(200, recorded);
    const rows = await appTester(App.searches.leaderboard.operation.perform, {
      authData: { routerKey: 'aism_x', dataKey: 'asl_live_test', mode: 'live' },
      inputData: { board: 'coding', vendor: 'anthropic', limit: 3 },
    });
    expect(rows.length).toBeLessThanOrEqual(3);
    rows.forEach(r => expect(r.vendor).toBe('anthropic'));
    expect(rows[0].rank).toBe(1);
  });

  it('Find Leaderboard without a data key explains what to add', async () => {
    await expect(appTester(App.searches.leaderboard.operation.perform, {
      authData: { routerKey: 'aism_x', mode: 'live' }, inputData: { board: 'combined' },
    })).rejects.toThrow(/data-keys/);
  });
});
