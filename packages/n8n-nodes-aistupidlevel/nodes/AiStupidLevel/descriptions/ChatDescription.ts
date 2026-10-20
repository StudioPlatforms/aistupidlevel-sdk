import type { INodeProperties } from 'n8n-workflow';

import {
	PINNED_MODE,
	REASONING_EFFORT_DESCRIPTION,
	REASONING_EFFORTS,
	ROUTING_MODES,
	SANDBOX_DESCRIPTION,
} from '../../shared/constants';

/** Routing mode, pinned model, prompt and system message: shared by Send Message and Preview Route. */
export function routedRequestFields(show: {
	resource: string[];
	operation: string[];
}): INodeProperties[] {
	return [
		{
			displayName: 'Routing Mode',
			name: 'routingMode',
			type: 'options',
			options: ROUTING_MODES,
			default: 'auto-best',
			description:
				'How the router picks the model, based on continuously re-run benchmarks. Pin a Model skips routing.',
			displayOptions: { show },
		},
		{
			displayName: 'Model Name or ID',
			name: 'pinnedModel',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getRoutableModels' },
			default: '',
			required: true,
			description:
				'The model to pin. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			displayOptions: { show: { ...show, routingMode: [PINNED_MODE] } },
		},
		{
			displayName: 'Prompt',
			name: 'prompt',
			type: 'string',
			typeOptions: { rows: 4 },
			default: '',
			required: true,
			placeholder: 'e.g. Summarize this support ticket in two sentences',
			description: 'The user message to send',
			displayOptions: { show },
		},
	];
}

export const chatOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['chat'] } },
		options: [
			{
				name: 'Send Message',
				value: 'sendMessage',
				description: 'Send a message to the model the router picks, and get its answer',
				action: 'Send a message',
			},
		],
		default: 'sendMessage',
	},
];

const show = { resource: ['chat'], operation: ['sendMessage'] };

export const chatFields: INodeProperties[] = [
	...routedRequestFields(show),
	{
		displayName: 'Simplify Output',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description:
			'Whether to return the answer with the routing decision (model, provider, reason) instead of the full completion',
		displayOptions: { show },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show },
		options: [
			{
				displayName: 'JSON Output',
				name: 'jsonOutput',
				type: 'boolean',
				default: false,
				description:
					'Whether to ask for a JSON object (response_format json_object) and parse it into "answerJson". Mention JSON in the prompt or the system message.',
			},
			{
				displayName: 'Maximum Tokens',
				name: 'maxTokens',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 1024,
				description: 'The most tokens the answer may use',
			},
			{
				displayName: 'Reasoning Effort',
				name: 'reasoningEffort',
				type: 'options',
				options: REASONING_EFFORTS,
				default: '',
				description: REASONING_EFFORT_DESCRIPTION,
			},
			{
				displayName: 'Sampling Temperature',
				name: 'temperature',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 1 },
				default: 0.7,
				description:
					'Controls randomness: lower is more focused and repeatable. Some models ignore it.',
			},
			{
				displayName: 'Sandbox',
				name: 'sandbox',
				type: 'boolean',
				default: false,
				description: SANDBOX_DESCRIPTION,
			},
			{
				displayName: 'System Message',
				name: 'systemMessage',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'Instructions that set how the model answers',
			},
			{
				displayName: 'Timeout',
				name: 'timeout',
				type: 'number',
				typeOptions: { minValue: 1000 },
				default: 300000,
				description: 'How long to wait for the answer, in milliseconds',
			},
		],
	},
];
