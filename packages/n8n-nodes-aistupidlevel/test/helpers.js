'use strict';
// Test helpers: a mocked n8n execution context whose HTTP helper answers from recorded fixtures.
// The fixtures in ./fixtures are real responses from aistupidlevel.info (router calls made with
// X-ASL-Sandbox: true), with keys redacted.

const fs = require('node:fs');
const path = require('node:path');
const { NodeApiError } = require('n8n-workflow');

function fixture(name) {
	return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8'));
}

/**
 * What n8n's httpRequestWithAuthentication throws for a non-2xx response: a NodeApiError that
 * already carries the status and the server's message (observed in n8n 2.42 against the live API).
 * Wrapping it again in a node hands back this same object.
 */
function httpError(node, status, body) {
	const serverMessage =
		body && typeof body === 'object'
			? body.message ?? (body.error && typeof body.error === 'object' ? body.error.message : undefined)
			: undefined;
	return new NodeApiError(
		node,
		{ message: `Request failed with status code ${status}`, description: serverMessage },
		{ httpCode: String(status) },
	);
}

/**
 * A minimal IExecuteFunctions. `params` maps parameter names to values (per item index when the
 * value is { perItem: [...] }); `respond(options, credential)` returns { status, headers, body }.
 */
function executeContext({ params, items = [{ json: {} }], respond, continueOnFail = false, executionId = '1234', runIndex = 0 }) {
	const calls = [];
	const node = { id: '7b0c3e7e-0000-4000-8000-000000000001', name: 'AI Stupid Level', type: 'n8n-nodes-aistupidlevel.aiStupidLevel', typeVersion: 1, position: [0, 0], parameters: {} };
	const ctx = {
		calls,
		getInputData: () => items,
		getNodeParameter(name, itemIndex, fallback) {
			if (!(name in params)) {
				if (arguments.length >= 3) return fallback;
				throw new Error(`Could not get parameter "${name}"`);
			}
			const value = params[name];
			if (value && typeof value === 'object' && Array.isArray(value.perItem)) return value.perItem[itemIndex];
			return value;
		},
		getNode: () => node,
		getExecutionId: () => executionId,
		getInstanceId: () => 'f1d2d2f924e986ac86fdf7b36c94bcdf32beec15f1d2d2f924e986ac86fdf7b3',
		getWorkflowDataProxy: () => ({ $thisRunIndex: runIndex }),
		continueOnFail: () => continueOnFail,
		logger: { debug() {}, info() {}, warn() {}, error() {} },
		helpers: {
			async httpRequestWithAuthentication(credential, options) {
				calls.push({ credential, options });
				const res = await respond(options, credential);
				if (res.status >= 400) throw httpError(node, res.status, res.body);
				if (options.returnFullResponse) {
					return { body: res.body, headers: res.headers ?? {}, statusCode: res.status ?? 200 };
				}
				return res.body;
			},
		},
	};
	return ctx;
}

module.exports = { fixture, executeContext, httpError };
