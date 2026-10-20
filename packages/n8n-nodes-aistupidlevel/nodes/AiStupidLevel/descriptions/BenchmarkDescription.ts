import type { INodeProperties } from 'n8n-workflow';

export const benchmarkOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['benchmark'] } },
		options: [
			{
				name: 'Get Alerts',
				value: 'getAlerts',
				description: 'Get the current performance alerts',
				action: 'Get alerts',
			},
			{
				name: 'Get Degradations',
				value: 'getDegradations',
				description: 'Get models whose scores have dropped',
				action: 'Get degradations',
			},
			{
				name: 'Get Drift Signature',
				value: 'getDrift',
				description:
					"Get a model's drift status: regime, change-point detector state and per-axis trends",
				action: 'Get a drift signature',
			},
			{
				name: 'Get Global Index',
				value: 'getGlobalIndex',
				description: 'Get the fleet-wide score index and its recent history',
				action: 'Get the global index',
			},
			{
				name: 'Get Incidents',
				value: 'getIncidents',
				description: 'Get detected incidents, newest first',
				action: 'Get incidents',
			},
			{
				name: 'Get Leaderboard',
				value: 'getLeaderboard',
				description: 'Get the ranked model scores',
				action: 'Get the leaderboard',
			},
			{
				name: 'Get Model',
				value: 'getModel',
				description: "Get one model's details",
				action: 'Get a model',
			},
			{
				name: 'Get Model History',
				value: 'getModelHistory',
				description: "Get a model's score history",
				action: 'Get a model score history',
			},
			{
				name: 'Get Provider Reliability',
				value: 'getProviderReliability',
				description: 'Get reliability figures per provider',
				action: 'Get provider reliability',
			},
			{
				name: 'Get Provider Status',
				value: 'getProviderStatus',
				description: 'Get the current status and response time of each provider',
				action: 'Get provider status',
			},
			{
				name: 'Get Recommendations',
				value: 'getRecommendations',
				description:
					'Get the recommended model per category (best for code, most reliable, best value)',
				action: 'Get recommendations',
			},
		],
		default: 'getLeaderboard',
	},
];

const periodOptions = [
	{
		name: 'Last 24 Hours',
		value: '24h',
		description: 'Measured average over the last 24 hours',
	},
	{
		name: 'Last 30 Days',
		value: '1m',
		description: 'Measured average over the last 30 days',
	},
	{
		name: 'Last 7 Days',
		value: '7d',
		description: 'Measured average over the last 7 days',
	},
	{
		name: 'Latest Run (Paid Plans)',
		value: 'latest',
		description: 'The newest benchmark run. Needs a paid Data API plan; a free key is refused.',
	},
];

export const benchmarkFields: INodeProperties[] = [
	{
		displayName: 'Model ID',
		name: 'modelId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 292',
		description:
			'The numeric model ID: the "ID" field of Get Leaderboard. A model name is not accepted.',
		displayOptions: {
			show: { resource: ['benchmark'], operation: ['getModel', 'getModelHistory', 'getDrift'] },
		},
	},
	{
		displayName: 'Period',
		name: 'period',
		type: 'options',
		options: periodOptions,
		default: '24h',
		description: 'Which scores to read',
		displayOptions: {
			show: {
				resource: ['benchmark'],
				operation: ['getLeaderboard', 'getModelHistory', 'getRecommendations', 'getDegradations'],
			},
		},
	},
	{
		displayName: 'Sort By',
		name: 'sortBy',
		type: 'options',
		options: [
			{ name: 'Coding', value: 'coding' },
			{ name: 'Combined Score', value: 'combined' },
			{ name: 'Price', value: 'price' },
			{ name: 'Reasoning', value: 'reasoning' },
			{ name: 'Speed', value: 'speed' },
			{ name: 'Tool Use', value: 'tooling' },
		],
		default: 'combined',
		description: 'Which score the leaderboard ranks by',
		displayOptions: { show: { resource: ['benchmark'], operation: ['getLeaderboard'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['benchmark'], operation: ['getLeaderboard'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: { resource: ['benchmark'], operation: ['getLeaderboard'], returnAll: [false] },
		},
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 200 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['benchmark'], operation: ['getIncidents'] } },
	},
	{
		displayName: 'Simplify Output',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description:
			'Whether to return the main fields of each model (position, ID, name, provider, score, confidence interval, trend) instead of the full row',
		displayOptions: { show: { resource: ['benchmark'], operation: ['getLeaderboard'] } },
	},
];
