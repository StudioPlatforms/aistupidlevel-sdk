import type { INodeProperties } from 'n8n-workflow';

import { routedRequestFields } from './ChatDescription';

export const routerOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['router'] } },
		options: [
			{
				name: 'Get Usage',
				value: 'getUsage',
				description: "Get this month's routed requests, allowance, credits and key budget",
				action: 'Get router usage',
			},
			{
				name: 'List Models',
				value: 'listModels',
				description: 'List the routing modes and the models you can pin',
				action: 'List router models',
			},
			{
				name: 'Preview Route',
				value: 'previewRoute',
				description: 'See which model a request would be routed to, and why, without sending it',
				action: 'Preview a route',
			},
			{
				name: 'Send Feedback',
				value: 'sendFeedback',
				description: 'Rate an answer the router gave',
				action: 'Send feedback on an answer',
			},
		],
		default: 'previewRoute',
	},
];

const preview = { resource: ['router'], operation: ['previewRoute'] };
const feedback = { resource: ['router'], operation: ['sendFeedback'] };
const listModels = { resource: ['router'], operation: ['listModels'] };

export const routerFields: INodeProperties[] = [
	// ── Preview Route ──────────────────────────────────────────────────────
	...routedRequestFields(preview),
	{
		displayName: 'Simplify Output',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description:
			'Whether to return the chosen model, its score, the reason and the fallbacks instead of the full response',
		displayOptions: { show: preview },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: preview },
		options: [
			{
				displayName: 'Sandbox',
				name: 'sandbox',
				type: 'boolean',
				default: false,
				description:
					'Whether to route as if you had a key for every provider, to see where a request would go before you add your keys',
			},
			{
				displayName: 'System Message',
				name: 'systemMessage',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'Instructions that set how the model answers',
			},
		],
	},

	// ── Send Feedback ──────────────────────────────────────────────────────
	{
		displayName: 'Request ID',
		name: 'requestId',
		type: 'string',
		default: '={{ $json.requestId }}',
		required: true,
		description:
			'The ID of the answer to rate: the "requestId" output of Send Message (the completion ID)',
		displayOptions: { show: feedback },
	},
	{
		displayName: 'Rating',
		name: 'rating',
		type: 'options',
		options: [
			{ name: 'Good Answer', value: 'up' },
			{ name: 'Bad Answer', value: 'down' },
		],
		default: 'up',
		description: 'Whether the answer was good or bad',
		displayOptions: { show: feedback },
	},

	// ── List Models ────────────────────────────────────────────────────────
	{
		displayName: 'Include Routing Modes',
		name: 'includeRoutingModes',
		type: 'boolean',
		default: true,
		description:
			'Whether to include the routing modes (auto, auto-coding and so on) as well as the models',
		displayOptions: { show: listModels },
	},
];
