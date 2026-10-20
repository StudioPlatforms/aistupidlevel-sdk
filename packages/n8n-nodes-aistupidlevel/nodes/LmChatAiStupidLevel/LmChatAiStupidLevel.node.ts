import { supplyModel } from '@n8n/ai-node-sdk';
import type {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	CLIENT_HEADER,
	PINNED_MODE,
	REASONING_EFFORT_DESCRIPTION,
	REASONING_EFFORTS,
	ROUTER_BASE_URL,
	ROUTER_CREDENTIAL,
	ROUTING_MODES,
	SANDBOX_DESCRIPTION,
} from '../shared/constants';
import { resolveModel } from '../shared/mapping';
import { getRoutableModels } from '../shared/transport';

interface ModelOptions {
	maxTokens?: number;
	maxRetries?: number;
	reasoningEffort?: string;
	sandbox?: boolean;
	temperature?: number;
	timeout?: number;
}

export class LmChatAiStupidLevel implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AI Stupid Level Chat Model',
		name: 'lmChatAiStupidLevel',
		icon: {
			light: 'file:../../icons/aistupidlevel.svg',
			dark: 'file:../../icons/aistupidlevel.dark.svg',
		},
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["routingMode"]}}',
		description:
			'Chat model for the AI Agent and chains: each request goes to the model measuring best for it, through the AI Stupid Level Smart Router',
		defaults: {
			name: 'AI Stupid Level Chat Model',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Language Models', 'Root Nodes'],
				'Language Models': ['Chat Models (Recommended)'],
			},
			resources: {
				primaryDocumentation: [
					{
						url: 'https://github.com/StudioPlatforms/aistupidlevel-sdk/tree/main/packages/n8n-nodes-aistupidlevel#ai-stupid-level-chat-model',
					},
				],
			},
		},
		inputs: [],
		outputs: [NodeConnectionTypes.AiLanguageModel],
		outputNames: ['Model'],
		credentials: [
			{
				name: ROUTER_CREDENTIAL,
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Routing Mode',
				name: 'routingMode',
				type: 'options',
				options: ROUTING_MODES,
				default: 'auto-tooling',
				description:
					'How the router picks the model for each call, based on continuously re-run benchmarks. Best for Tool Use suits agents that call tools.',
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
				displayOptions: { show: { routingMode: [PINNED_MODE] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				placeholder: 'Add Option',
				description: 'Additional options to add',
				type: 'collection',
				default: {},
				options: [
					{
						displayName: 'Max Retries',
						name: 'maxRetries',
						type: 'number',
						typeOptions: { minValue: 0 },
						default: 2,
						description: 'How many times to retry a failed request',
					},
					{
						displayName: 'Maximum Tokens',
						name: 'maxTokens',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 4096,
						description: 'The most tokens one answer may use',
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
						displayName: 'Timeout',
						name: 'timeout',
						type: 'number',
						typeOptions: { minValue: 1000 },
						default: 300000,
						description: 'How long to wait for one answer, in milliseconds',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			getRoutableModels,
		},
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials<{ apiKey: string }>(ROUTER_CREDENTIAL);
		const routingMode = this.getNodeParameter('routingMode', itemIndex) as string;
		const pinnedModel = this.getNodeParameter('pinnedModel', itemIndex, '') as string;
		const options = this.getNodeParameter('options', itemIndex, {}) as ModelOptions;

		let model: string;
		try {
			model = resolveModel(routingMode, pinnedModel);
		} catch (error) {
			throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex });
		}

		const defaultHeaders: Record<string, string> = { 'X-ASL-Client': CLIENT_HEADER };
		if (options.sandbox) defaultHeaders['X-ASL-Sandbox'] = 'true';

		// The router accepts every reasoning level for every model (including xhigh and max, which the
		// OpenAI client's own "reasoning" option does not know), so it is sent as a plain parameter.
		const additionalParams: Record<string, unknown> = {};
		if (options.reasoningEffort) additionalParams.reasoning_effort = options.reasoningEffort;

		return supplyModel(this, {
			type: 'openai',
			baseUrl: ROUTER_BASE_URL,
			apiKey: credentials.apiKey,
			model,
			temperature: options.temperature,
			maxTokens: options.maxTokens,
			timeout: options.timeout,
			maxRetries: options.maxRetries,
			defaultHeaders,
			additionalParams,
		});
	}
}
