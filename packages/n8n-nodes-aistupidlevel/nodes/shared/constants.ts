import type { INodePropertyOptions } from 'n8n-workflow';

/** Kept equal to package.json "version" (a unit test checks it). */
export const PACKAGE_VERSION = '0.1.0';

export const CLIENT_HEADER = `n8n-nodes-aistupidlevel/${PACKAGE_VERSION}`;

export const ROUTER_BASE_URL = 'https://aistupidlevel.info/v1';

export const DATA_API_BASE_URL = 'https://aistupidlevel.info/api/v1';

export const ROUTER_CREDENTIAL = 'aiStupidLevelRouterApi';

export const DATA_CREDENTIAL = 'aiStupidLevelDataApi';

/** The value of the routing-mode parameter that pins one model instead of routing. */
export const PINNED_MODE = '__pinned__';

/**
 * Routing modes accepted as the "model" of a request. Descriptions follow the router
 * documentation at https://aistupidlevel.info/router/docs. Aliases (auto-agentic,
 * auto-value-agentic, auto-creative) are left out: they route exactly like the modes they alias.
 */
export const ROUTING_MODES: INodePropertyOptions[] = [
	{
		name: 'Auto (Saved Preference)',
		value: 'auto',
		description: 'Uses the routing strategy saved in your router preferences',
	},
	{
		name: 'Best Overall',
		value: 'auto-best',
		description: 'Highest combined benchmark score',
	},
	{
		name: 'Best for Coding',
		value: 'auto-coding',
		description: 'Highest score on the coding suite',
	},
	{
		name: 'Best for Reasoning',
		value: 'auto-reasoning',
		description: 'Highest score on the reasoning suite',
	},
	{
		name: 'Best for Tool Use',
		value: 'auto-tooling',
		description: 'Highest score on the tool-calling suite; a good default for agents',
	},
	{
		name: 'Best Value',
		value: 'auto-value',
		description:
			'Most combined-score points per measured dollar, among models within 5 points of the best',
	},
	{
		name: 'Best Value for Coding',
		value: 'auto-value-coding',
		description: 'Most coding points per measured dollar, among near-top models',
	},
	{
		name: 'Best Value for Reasoning',
		value: 'auto-value-reasoning',
		description: 'Most reasoning points per measured dollar, among near-top models',
	},
	{
		name: 'Best Value for Tool Use',
		value: 'auto-value-tooling',
		description: 'Most tool-use points per measured dollar, among near-top models',
	},
	{
		name: 'Cheapest',
		value: 'auto-cheapest',
		description: 'Lowest list price per token among your providers, with no quality bar',
	},
	{
		name: 'Fastest',
		value: 'auto-fastest',
		description: 'Lowest measured latency, with no quality bar',
	},
	{
		name: 'Fastest Near the Top',
		value: 'auto-fastest-quality',
		description: 'The fastest model among those within 5 points of the best',
	},
	{
		name: 'Match the Task',
		value: 'auto-task',
		description:
			'Reads each request and picks the matching benchmark (tools, reasoning, code or overall)',
	},
	{
		name: 'Most Consistent',
		value: 'auto-consistent',
		description:
			'Among models within 5 points of the best, the one whose score varies least between runs',
	},
	{
		name: 'Pin a Model',
		value: PINNED_MODE,
		description: 'Always use one model of your choice, with no routing',
	},
	{
		name: 'Your Traffic Split',
		value: 'auto-split',
		description: 'The weighted split across models that you set in your router preferences',
	},
];

export const REASONING_EFFORTS: INodePropertyOptions[] = [
	{ name: 'Model Default', value: '' },
	{ name: 'None', value: 'none' },
	{ name: 'Minimal', value: 'minimal' },
	{ name: 'Low', value: 'low' },
	{ name: 'Medium', value: 'medium' },
	{ name: 'High', value: 'high' },
	{ name: 'Extra High', value: 'xhigh' },
	{ name: 'Max', value: 'max' },
];

export const REASONING_EFFORT_DESCRIPTION =
	'How much the model reasons before answering. Every level is accepted for every model: a level the chosen model does not support is mapped to the nearest one it does';

export const SANDBOX_DESCRIPTION =
	'Whether to run the real routing but return a mock answer. Nothing is sent to a provider and nothing is spent or counted. Use it to build and test a workflow';
