'use strict';
// Package-level checks: what n8n loads (package.json "n8n" section) exists in dist/, the
// credentials are wired to their test requests, and the chat model sub-node supplies a model
// configured for the router.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('package', () => {
	test('every node and credential listed for n8n is built', () => {
		for (const file of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) {
			assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing; run npm run build`);
		}
	});

	test('no runtime dependencies; only n8n-provided peer dependencies', () => {
		assert.equal(pkg.dependencies, undefined);
		assert.deepEqual(Object.keys(pkg.peerDependencies).sort(), ['@n8n/ai-node-sdk', 'n8n-workflow']);
		assert.equal(pkg.n8n.aiNodeSdkVersion, 1);
		assert.ok(pkg.keywords.includes('n8n-community-node-package'));
		assert.equal(pkg.license, 'MIT');
	});

	test('devDependencies are pinned exactly', () => {
		for (const [name, version] of Object.entries(pkg.devDependencies)) {
			assert.match(version, /^\d+\.\d+\.\d+$/, `${name} is not pinned: ${version}`);
		}
	});

	test('the client version header matches the package version', () => {
		const { PACKAGE_VERSION } = require('../dist/nodes/shared/constants.js');
		assert.equal(PACKAGE_VERSION, pkg.version);
	});

	test('icons referenced by the nodes and credentials are built', () => {
		for (const icon of ['aistupidlevel.svg', 'aistupidlevel.dark.svg']) {
			assert.ok(fs.existsSync(path.join(root, 'dist/icons', icon)));
		}
	});
});

describe('credentials', () => {
	const { AiStupidLevelRouterApi } = require('../dist/credentials/AiStupidLevelRouterApi.credentials.js');
	const { AiStupidLevelDataApi } = require('../dist/credentials/AiStupidLevelDataApi.credentials.js');

	test('router key: bearer header, tested with GET /v1/usage', () => {
		const c = new AiStupidLevelRouterApi();
		assert.equal(c.name, 'aiStupidLevelRouterApi');
		assert.equal(c.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
		assert.equal(c.test.request.baseURL + c.test.request.url, 'https://aistupidlevel.info/v1/usage');
		assert.equal(c.properties[0].typeOptions.password, true);
	});

	test('data key: bearer header, tested with GET /api/v1/me', () => {
		const c = new AiStupidLevelDataApi();
		assert.equal(c.name, 'aiStupidLevelDataApi');
		assert.equal(c.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
		assert.equal(c.test.request.baseURL + c.test.request.url, 'https://aistupidlevel.info/api/v1/me');
		assert.equal(c.properties[0].typeOptions.password, true);
	});

	test('the main node asks for the right key per resource', () => {
		const { AiStupidLevel } = require('../dist/nodes/AiStupidLevel/AiStupidLevel.node.js');
		const creds = new AiStupidLevel().description.credentials;
		assert.deepEqual(creds.find((c) => c.name === 'aiStupidLevelRouterApi').displayOptions.show.resource.sort(), ['chat', 'router']);
		assert.deepEqual(creds.find((c) => c.name === 'aiStupidLevelDataApi').displayOptions.show.resource, ['benchmark']);
	});
});

describe('AI Stupid Level Chat Model (sub-node)', () => {
	const { LmChatAiStupidLevel } = require('../dist/nodes/LmChatAiStupidLevel/LmChatAiStupidLevel.node.js');
	const subNode = new LmChatAiStupidLevel();

	function supplyContext(params) {
		return {
			getCredentials: async (name) => {
				assert.equal(name, 'aiStupidLevelRouterApi');
				return { apiKey: 'aism_test_not_a_real_key' };
			},
			getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
			getNode: () => ({ id: 'n1', name: 'AI Stupid Level Chat Model', type: 'n8n-nodes-aistupidlevel.lmChatAiStupidLevel', typeVersion: 1, parameters: {} }),
			logger: { debug() {}, info() {}, warn() {}, error() {} },
			helpers: { getSecureEgressFilter: () => 'disabled' },
		};
	}

	test('outputs a language model for the AI Agent', () => {
		assert.deepEqual(subNode.description.outputs, ['ai_languageModel']);
		assert.deepEqual(subNode.description.inputs, []);
	});

	test('supplies an OpenAI-compatible chat model pointed at the router', async () => {
		const { response: model } = await subNode.supplyData.call(
			supplyContext({ routingMode: 'auto-tooling', options: { sandbox: true, reasoningEffort: 'xhigh', temperature: 0.3, maxTokens: 512 } }),
			0,
		);
		assert.equal(model.model, 'auto-tooling');
		assert.equal(model.temperature, 0.3);
		assert.equal(model.maxTokens, 512);
		assert.deepEqual(model.modelKwargs, { reasoning_effort: 'xhigh' });
		assert.equal(model.clientConfig.baseURL, 'https://aistupidlevel.info/v1');
		assert.equal(model.clientConfig.defaultHeaders['X-ASL-Sandbox'], 'true');
		assert.match(model.clientConfig.defaultHeaders['X-ASL-Client'], /^n8n-nodes-aistupidlevel\//);
	});

	test('a pinned model is passed through; no sandbox header unless asked', async () => {
		const { response: model } = await subNode.supplyData.call(
			supplyContext({ routingMode: '__pinned__', pinnedModel: 'claude-opus-5-5', options: {} }),
			0,
		);
		assert.equal(model.model, 'claude-opus-5-5');
		assert.equal(model.clientConfig.defaultHeaders['X-ASL-Sandbox'], undefined);
	});
});
