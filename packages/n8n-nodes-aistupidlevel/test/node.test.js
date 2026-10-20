'use strict';
// Unit tests for the AI Stupid Level node: request building and response mapping, against the
// compiled output in dist/ (run `npm run build` first; `npm test` does both).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { AiStupidLevel } = require('../dist/nodes/AiStupidLevel/AiStupidLevel.node.js');
const { NodeApiError, NodeOperationError } = require('n8n-workflow');
const { fixture, executeContext } = require('./helpers');

const node = new AiStupidLevel();
const run = (ctx) => node.execute.call(ctx);

describe('Chat: Send Message', () => {
	const chat = fixture('router-chat');

	test('builds the routed request and maps the routing headers', async () => {
		const ctx = executeContext({
			params: {
				resource: 'chat',
				operation: 'sendMessage',
				routingMode: 'auto-coding',
				prompt: 'Write a haiku about routers.',
				simplify: true,
				options: { systemMessage: 'Answer briefly.', maxTokens: 200, reasoningEffort: 'max', temperature: 0.2, sandbox: true },
			},
			respond: () => chat,
		});
		const [[item]] = await run(ctx);

		assert.equal(ctx.calls.length, 1);
		const { credential, options } = ctx.calls[0];
		assert.equal(credential, 'aiStupidLevelRouterApi');
		assert.equal(options.method, 'POST');
		assert.equal(options.baseURL, 'https://aistupidlevel.info/v1');
		assert.equal(options.url, '/chat/completions');
		assert.equal(options.returnFullResponse, true);
		assert.deepEqual(options.body, {
			model: 'auto-coding',
			messages: [
				{ role: 'system', content: 'Answer briefly.' },
				{ role: 'user', content: 'Write a haiku about routers.' },
			],
			temperature: 0.2,
			max_tokens: 200,
			reasoning_effort: 'max',
		});
		assert.equal(options.headers['X-ASL-Sandbox'], 'true');
		assert.match(options.headers['X-ASL-Client'], /^n8n-nodes-aistupidlevel\/\d+\.\d+\.\d+$/);
		assert.match(options.headers['Idempotency-Key'], /^n8n-[\x21-\x7e]+$/);
		assert.ok(options.headers['Idempotency-Key'].length <= 255);
		assert.equal(options.headers.Authorization, undefined, 'the key is added by the credential, never by the node');

		assert.deepEqual(item.pairedItem, { item: 0 });
		const out = item.json;
		assert.equal(out.answer, chat.body.choices[0].message.content);
		assert.equal(out.model, 'claude-opus-5-5');
		assert.equal(out.provider, 'anthropic');
		assert.match(out.routingReason, /best coding performance/);
		assert.equal(out.requestId, 'chatcmpl-mvgbbwy5gydhhhpw');
		assert.equal(out.finishReason, 'stop');
		assert.equal(out.sandbox, true);
		assert.equal(out.fallback, false);
		assert.equal(out.latencyMs, 7);
		assert.deepEqual(out.usage, chat.body.usage);
	});

	test('omits unset options and sends no sandbox header by default', async () => {
		const ctx = executeContext({
			params: { resource: 'chat', operation: 'sendMessage', routingMode: 'auto-best', prompt: 'Hi', simplify: true, options: {} },
			respond: () => chat,
		});
		await run(ctx);
		const { options } = ctx.calls[0];
		assert.deepEqual(options.body, { model: 'auto-best', messages: [{ role: 'user', content: 'Hi' }] });
		assert.equal(options.headers['X-ASL-Sandbox'], undefined);
	});

	test('a pinned model replaces the routing mode', async () => {
		const ctx = executeContext({
			params: { resource: 'chat', operation: 'sendMessage', routingMode: '__pinned__', pinnedModel: 'gpt-6-luna', prompt: 'Hi', simplify: true, options: {} },
			respond: () => chat,
		});
		await run(ctx);
		assert.equal(ctx.calls[0].options.body.model, 'gpt-6-luna');
	});

	test('"Pin a Model" without a model is a configuration error, before any request', async () => {
		const ctx = executeContext({
			params: { resource: 'chat', operation: 'sendMessage', routingMode: '__pinned__', pinnedModel: '', prompt: 'Hi', simplify: true, options: {} },
			respond: () => chat,
		});
		await assert.rejects(run(ctx), (e) => e instanceof NodeOperationError && /model to pin/.test(e.message));
		assert.equal(ctx.calls.length, 0);
	});

	test('an empty prompt is a configuration error', async () => {
		const ctx = executeContext({
			params: { resource: 'chat', operation: 'sendMessage', routingMode: 'auto', prompt: '  ', simplify: true, options: {} },
			respond: () => chat,
		});
		await assert.rejects(run(ctx), NodeOperationError);
	});

	test('JSON output asks for json_object and parses the answer', async () => {
		const ctx = executeContext({
			params: { resource: 'chat', operation: 'sendMessage', routingMode: 'auto-value', prompt: 'Return a JSON object with a field ok.', simplify: true, options: { jsonOutput: true, sandbox: true } },
			respond: () => fixture('router-chatjson'),
		});
		const [[item]] = await run(ctx);
		assert.deepEqual(ctx.calls[0].options.body.response_format, { type: 'json_object' });
		assert.deepEqual(item.json.answerJson, { sandbox: true, model: 'gpt-6-luna', provider: 'openai' });
		assert.equal(item.json.answerJsonError, undefined);
	});

	test('JSON output that is not JSON is reported, not thrown', async () => {
		const ctx = executeContext({
			params: { resource: 'chat', operation: 'sendMessage', routingMode: 'auto', prompt: 'x', simplify: true, options: { jsonOutput: true } },
			respond: () => chat,
		});
		const [[item]] = await run(ctx);
		assert.equal(item.json.answerJson, undefined);
		assert.match(item.json.answerJsonError, /not valid JSON/);
	});

	test('Simplify Output off returns the full completion plus routing', async () => {
		const ctx = executeContext({
			params: { resource: 'chat', operation: 'sendMessage', routingMode: 'auto-coding', prompt: 'x', simplify: false, options: {} },
			respond: () => chat,
		});
		const [[item]] = await run(ctx);
		assert.equal(item.json.id, chat.body.id);
		assert.deepEqual(item.json.choices, chat.body.choices);
		assert.equal(item.json.routing.model, 'claude-opus-5-5');
		assert.equal(item.json.routing.provider, 'anthropic');
	});

	test('one request per input item, each paired to its item', async () => {
		const ctx = executeContext({
			items: [{ json: {} }, { json: {} }],
			params: { resource: 'chat', operation: 'sendMessage', routingMode: 'auto', prompt: { perItem: ['a', 'b'] }, simplify: true, options: {} },
			respond: () => chat,
		});
		const [out] = await run(ctx);
		assert.equal(out.length, 2);
		assert.deepEqual(out.map((o) => o.pairedItem.item), [0, 1]);
		assert.deepEqual(ctx.calls.map((c) => c.options.body.messages[0].content), ['a', 'b']);
		const keys = ctx.calls.map((c) => c.options.headers['Idempotency-Key']);
		assert.notEqual(keys[0], keys[1]);
	});
});

describe('Idempotency-Key', () => {
	const chat = fixture('router-chat');
	const keyFor = async (overrides = {}) => {
		const ctx = executeContext({
			params: { resource: 'chat', operation: 'sendMessage', routingMode: 'auto', prompt: overrides.prompt ?? 'same', simplify: true, options: {} },
			respond: () => chat,
			executionId: overrides.executionId ?? '99',
			runIndex: overrides.runIndex ?? 0,
		});
		await run(ctx);
		return ctx.calls[0].options.headers['Idempotency-Key'];
	};

	test('is the same for a retry of the same request (n8n "Retry On Fail")', async () => {
		assert.equal(await keyFor(), await keyFor());
	});

	test('differs for another execution, another run (loops) or another body', async () => {
		const base = await keyFor();
		assert.notEqual(base, await keyFor({ executionId: '100' }));
		assert.notEqual(base, await keyFor({ runIndex: 1 }));
		assert.notEqual(base, await keyFor({ prompt: 'different' }));
	});

	test('is not sent without an execution id', async () => {
		const ctx = executeContext({
			params: { resource: 'chat', operation: 'sendMessage', routingMode: 'auto', prompt: 'x', simplify: true, options: {} },
			respond: () => chat,
			executionId: '',
		});
		await run(ctx);
		assert.equal(ctx.calls[0].options.headers['Idempotency-Key'], undefined);
	});
});

describe('Router operations', () => {
	test('Preview Route posts the same body and simplifies the decision', async () => {
		const preview = fixture('router-preview');
		const ctx = executeContext({
			params: { resource: 'router', operation: 'previewRoute', routingMode: 'auto-reasoning', prompt: 'Prove that sqrt(2) is irrational.', simplify: true, options: { sandbox: true } },
			respond: () => preview,
		});
		const [[item]] = await run(ctx);
		const { options } = ctx.calls[0];
		assert.equal(options.url, '/route/preview');
		assert.equal(options.method, 'POST');
		assert.equal(options.body.model, 'auto-reasoning');
		assert.equal(options.headers['X-ASL-Sandbox'], 'true');
		assert.equal(options.headers['Idempotency-Key'], undefined);
		assert.deepEqual(item.json, {
			requestedModel: 'auto-reasoning',
			strategy: 'best_reasoning',
			model: 'claude-fable-5-1',
			provider: 'anthropic',
			score: 100,
			routingReason: preview.body.primary.reasoning,
			estimatedCostUsd: 0.03,
			fallbackEnabled: true,
			fallbacks: [
				{ model: 'kimi-k3', provider: 'kimi', score: 100, estimatedCostUsd: 0.009 },
				{ model: 'gemini-3.8-flash', provider: 'google', score: 99, estimatedCostUsd: 0.0045 },
			],
			sandbox: true,
		});
	});

	test('Get Usage returns the usage object', async () => {
		const usage = fixture('router-usage');
		const ctx = executeContext({ params: { resource: 'router', operation: 'getUsage' }, respond: () => usage });
		const [[item]] = await run(ctx);
		assert.equal(ctx.calls[0].options.method, 'GET');
		assert.equal(ctx.calls[0].options.url, '/usage');
		assert.deepEqual(item.json, usage.body);
	});

	test('Send Feedback posts the id and rating', async () => {
		const ctx = executeContext({
			params: { resource: 'router', operation: 'sendFeedback', requestId: ' chatcmpl-abc ', rating: 'down' },
			respond: () => ({ status: 200, headers: {}, body: { success: true } }),
		});
		const [[item]] = await run(ctx);
		assert.equal(ctx.calls[0].options.url, '/router/feedback');
		assert.deepEqual(ctx.calls[0].options.body, { id: 'chatcmpl-abc', rating: 'down' });
		assert.deepEqual(item.json, { requestId: 'chatcmpl-abc', rating: 'down', success: true });
	});

	test('List Models marks routing modes and can leave them out', async () => {
		const models = fixture('router-models');
		const all = executeContext({ params: { resource: 'router', operation: 'listModels', includeRoutingModes: true }, respond: () => models });
		const [allItems] = await run(all);
		assert.equal(allItems.length, models.body.data.length);
		assert.equal(allItems.find((i) => i.json.id === 'auto-coding').json.routingMode, true);

		const only = executeContext({ params: { resource: 'router', operation: 'listModels', includeRoutingModes: false }, respond: () => models });
		const [modelItems] = await run(only);
		assert.ok(modelItems.length > 0);
		assert.ok(modelItems.every((i) => i.json.routingMode === false && !i.json.id.startsWith('auto')));
	});

	test('the model dropdown lists pinnable models only, sorted', async () => {
		const models = fixture('router-models');
		const ctx = executeContext({ params: {}, respond: () => models });
		const options = await node.methods.loadOptions.getRoutableModels.call(ctx);
		assert.ok(options.length > 0);
		assert.ok(options.every((o) => !String(o.value).startsWith('auto')));
		const names = options.map((o) => o.name);
		assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
	});
});

describe('Benchmark operations (Data API)', () => {
	test('Get Leaderboard reads /models with period and sort, simplified and limited', async () => {
		const models = fixture('data-models');
		const ctx = executeContext({
			params: { resource: 'benchmark', operation: 'getLeaderboard', period: '7d', sortBy: 'coding', returnAll: false, limit: 3, simplify: true },
			respond: () => models,
		});
		const [items] = await run(ctx);
		const { credential, options } = ctx.calls[0];
		assert.equal(credential, 'aiStupidLevelDataApi');
		assert.equal(options.baseURL, 'https://aistupidlevel.info/api/v1');
		assert.equal(options.url, '/models');
		assert.deepEqual(options.qs, { period: '7d', sortBy: 'coding' });
		assert.equal(items.length, 3);
		const first = models.body.data[0];
		assert.deepEqual(items[0].json, {
			position: 1,
			id: first.id,
			model: first.name,
			displayName: first.displayName,
			provider: first.provider,
			score: first.currentScore,
			confidenceLower: first.confidenceLower,
			confidenceUpper: first.confidenceUpper,
			trend: first.trend,
			status: first.status,
			stale: first.isStale,
			suites: first.suites,
			lastUpdated: first.lastUpdated,
		});
		assert.ok(items.every((i) => i.pairedItem.item === 0));
	});

	test('Get Leaderboard with Return All and no simplification returns every full row', async () => {
		const models = fixture('data-models');
		const ctx = executeContext({
			params: { resource: 'benchmark', operation: 'getLeaderboard', period: '24h', sortBy: 'combined', returnAll: true, limit: 1, simplify: false },
			respond: () => models,
		});
		const [items] = await run(ctx);
		assert.equal(items.length, models.body.data.length);
		assert.deepEqual(items[0].json, models.body.data[0]);
	});

	test('Get Model uses the numeric id and unwraps the envelope', async () => {
		const model = fixture('data-model');
		const ctx = executeContext({ params: { resource: 'benchmark', operation: 'getModel', modelId: ' 292 ' }, respond: () => model });
		const [[item]] = await run(ctx);
		assert.equal(ctx.calls[0].options.url, '/models/292');
		assert.deepEqual(item.json, model.body.data);
	});

	test('a model name instead of an id is refused before any request', async () => {
		const ctx = executeContext({ params: { resource: 'benchmark', operation: 'getDrift', modelId: 'claude-opus-5-5' }, respond: () => fixture('data-drift') });
		await assert.rejects(run(ctx), (e) => e instanceof NodeOperationError && /numeric "id"/.test(e.message));
		assert.equal(ctx.calls.length, 0);
	});

	test('Get Model History returns one item per point, tagged with the model id', async () => {
		const history = fixture('data-history');
		const ctx = executeContext({ params: { resource: 'benchmark', operation: 'getModelHistory', modelId: '292', period: '24h' }, respond: () => history });
		const [items] = await run(ctx);
		assert.equal(ctx.calls[0].options.url, '/models/292/history');
		assert.deepEqual(ctx.calls[0].options.qs, { period: '24h' });
		assert.equal(items.length, history.body.data.length);
		assert.equal(items[0].json.modelId, 292);
		assert.equal(items[0].json.score, history.body.data[0].score);
	});

	test('Get Drift Signature returns the signature', async () => {
		const drift = fixture('data-drift');
		const ctx = executeContext({ params: { resource: 'benchmark', operation: 'getDrift', modelId: '292' }, respond: () => drift });
		const [[item]] = await run(ctx);
		assert.equal(ctx.calls[0].options.url, '/drift/292');
		assert.equal(item.json.regime, drift.body.data.regime);
		assert.equal(item.json.driftStatus, drift.body.data.driftStatus);
	});

	test('Get Incidents passes the limit and returns one item per incident', async () => {
		const incidents = fixture('data-incidents');
		const ctx = executeContext({ params: { resource: 'benchmark', operation: 'getIncidents', limit: 5 }, respond: () => incidents });
		const [items] = await run(ctx);
		assert.deepEqual(ctx.calls[0].options.qs, { limit: 5 });
		assert.equal(items.length, incidents.body.data.length);
		assert.equal(items[0].json.incidentType, incidents.body.data[0].incidentType);
	});

	test('Get Provider Status turns the provider map into one item per provider', async () => {
		const providers = fixture('data-providers');
		const ctx = executeContext({ params: { resource: 'benchmark', operation: 'getProviderStatus' }, respond: () => providers });
		const [items] = await run(ctx);
		assert.equal(ctx.calls[0].options.url, '/providers');
		assert.deepEqual(items.map((i) => i.json.provider).sort(), Object.keys(providers.body.data).sort());
		assert.equal(items[0].json.status, providers.body.data[items[0].json.provider].status);
	});

	test('Get Recommendations and Get Global Index return one object each', async () => {
		const recs = fixture('data-recommendations');
		const ctx = executeContext({ params: { resource: 'benchmark', operation: 'getRecommendations', period: '24h' }, respond: () => recs });
		const [items] = await run(ctx);
		assert.equal(ctx.calls[0].options.url, '/analytics/recommendations');
		assert.equal(items.length, 1);
		assert.equal(items[0].json.bestForCode.name, recs.body.data.bestForCode.name);

		const index = fixture('data-index');
		const ctx2 = executeContext({ params: { resource: 'benchmark', operation: 'getGlobalIndex' }, respond: () => index });
		const [items2] = await run(ctx2);
		assert.equal(ctx2.calls[0].options.url, '/index');
		assert.equal(items2[0].json.current.globalScore, index.body.data.current.globalScore);
	});
});

describe('Errors', () => {
	test("a refused latest period surfaces the API's explanation", async () => {
		const refused = fixture('data-latest_refused');
		const ctx = executeContext({
			params: { resource: 'benchmark', operation: 'getLeaderboard', period: 'latest', sortBy: 'combined', returnAll: true, simplify: true },
			respond: () => refused,
		});
		await assert.rejects(run(ctx), (e) => {
			assert.ok(e instanceof NodeApiError);
			assert.match(`${e.message} ${e.description}`, /paid plans/);
			return true;
		});
	});

	test('a rate limit explains the free-tier limits', async () => {
		const ctx = executeContext({
			params: { resource: 'benchmark', operation: 'getAlerts' },
			respond: () => ({ status: 429, headers: {}, body: { error: 'rate_limited' } }),
		});
		await assert.rejects(run(ctx), (e) => e instanceof NodeApiError && /10 requests a day/.test(e.description));
	});

	test('a server message is kept and the hint is added after it', async () => {
		const ctx = executeContext({
			params: { resource: 'router', operation: 'getUsage' },
			respond: () => ({ status: 401, headers: {}, body: { error: { message: 'Invalid router key' } } }),
		});
		await assert.rejects(run(ctx), (e) => {
			assert.ok(e instanceof NodeApiError);
			assert.match(`${e.message} ${e.description}`, /Invalid router key/);
			assert.match(e.description, /starts with aism_/);
			return true;
		});
	});

	test('with Continue On Fail, the error becomes an output item', async () => {
		const ctx = executeContext({
			continueOnFail: true,
			params: { resource: 'router', operation: 'getUsage' },
			respond: () => ({ status: 401, headers: {}, body: { error: { message: 'Invalid router key' } } }),
		});
		const [[item]] = await run(ctx);
		assert.ok(typeof item.json.error === 'string' && item.json.error.length > 0);
		assert.deepEqual(item.pairedItem, { item: 0 });
	});
});
