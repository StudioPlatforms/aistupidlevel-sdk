import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { DATA_CREDENTIAL, ROUTER_CREDENTIAL } from '../shared/constants';
import {
	buildChatBody,
	buildIdempotencyKey,
	buildRouterHeaders,
	mapCompletion,
	mapRoutePreview,
	normalizeDataModelId,
	simplifyLeaderboardRow,
	toItemJson,
	unwrapEnvelope,
} from '../shared/mapping';
import { dataRequest, getRoutableModels, routerRequest } from '../shared/transport';
import { benchmarkFields, benchmarkOperations } from './descriptions/BenchmarkDescription';
import { chatFields, chatOperations } from './descriptions/ChatDescription';
import { routerFields, routerOperations } from './descriptions/RouterDescription';

interface ChatOptions {
	jsonOutput?: boolean;
	maxTokens?: number;
	reasoningEffort?: string;
	sandbox?: boolean;
	temperature?: number;
	systemMessage?: string;
	timeout?: number;
}

/** A hint added to an API error for the cases a user can act on. */
function hintFor(error: JsonObject, resource: string): string | undefined {
	const status = String(
		(error as IDataObject).httpCode ??
			((error as IDataObject).response as IDataObject | undefined)?.status ??
			'',
	);
	if (status === '429' && resource === 'benchmark') {
		return 'Rate limit reached. The free Data API tier allows 10 requests a day and 1 a minute; consider "Execute Once" in the node settings, or a paid plan.';
	}
	if (status === '401') {
		return resource === 'benchmark'
			? 'The key was not accepted. Check the AI Stupid Level Data API credential: a Data API key starts with asl_live_.'
			: 'The key was not accepted. Check the AI Stupid Level Router API credential: a router key starts with aism_.';
	}
	return undefined;
}

export class AiStupidLevel implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AI Stupid Level',
		name: 'aiStupidLevel',
		icon: {
			light: 'file:../../icons/aistupidlevel.svg',
			dark: 'file:../../icons/aistupidlevel.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Route prompts to the best-measured LLM with the Smart Router, and read benchmark, drift and incident data',
		defaults: {
			name: 'AI Stupid Level',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: ROUTER_CREDENTIAL,
				required: true,
				displayOptions: { show: { resource: ['chat', 'router'] } },
			},
			{
				name: DATA_CREDENTIAL,
				required: true,
				displayOptions: { show: { resource: ['benchmark'] } },
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Benchmark',
						value: 'benchmark',
						description: 'Scores, drift, incidents and recommendations (Data API key)',
					},
					{
						name: 'Chat',
						value: 'chat',
						description: 'Send a message through the Smart Router (router key)',
					},
					{
						name: 'Router',
						value: 'router',
						description: 'Route previews, usage, feedback and models (router key)',
					},
				],
				default: 'chat',
			},
			...chatOperations,
			...chatFields,
			...routerOperations,
			...routerFields,
			...benchmarkOperations,
			...benchmarkFields,
		],
	};

	methods = {
		loadOptions: {
			getRoutableModels,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const resourceOf = (i: number) => {
			try {
				return this.getNodeParameter('resource', i) as string;
			} catch {
				return '';
			}
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let results: IDataObject[];

				if (resource === 'chat' && operation === 'sendMessage') {
					results = [await sendMessage.call(this, i)];
				} else if (resource === 'router') {
					results = await runRouterOperation.call(this, operation, i);
				} else if (resource === 'benchmark') {
					results = await runBenchmarkOperation.call(this, operation, i);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported`,
						{
							itemIndex: i,
						},
					);
				}

				for (const json of results) {
					returnData.push({ json, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
				}
				const apiError = new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
				const hint = hintFor(error as JsonObject, resourceOf(i));
				if (hint) {
					apiError.description = apiError.description ? `${apiError.description} ${hint}` : hint;
				}
				throw apiError;
			}
		}

		return [returnData];
	}
}

async function sendMessage(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const options = this.getNodeParameter('options', i, {}) as ChatOptions;
	const simplify = this.getNodeParameter('simplify', i, true) as boolean;
	const body = chatBody.call(this, i, options);

	const executionId = this.getExecutionId();
	let idempotencyKey: string | undefined;
	// No execution id (some test contexts): send no key rather than one shared by every run.
	if (executionId) {
		idempotencyKey = buildIdempotencyKey({
			instanceId: this.getInstanceId(),
			executionId,
			nodeId: this.getNode().id,
			runIndex: runIndexOf.call(this, i),
			itemIndex: i,
			body,
		});
	}

	const response = await routerRequest.call(this, 'POST', '/chat/completions', {
		body,
		headers: buildRouterHeaders({ sandbox: options.sandbox === true, idempotencyKey }),
		timeout: options.timeout,
	});
	return mapCompletion(response.body, response.headers, {
		simplify,
		jsonOutput: options.jsonOutput === true,
	});
}

function chatBody(this: IExecuteFunctions, i: number, options: ChatOptions): IDataObject {
	const routingMode = this.getNodeParameter('routingMode', i) as string;
	const pinnedModel = this.getNodeParameter('pinnedModel', i, '') as string;
	const prompt = this.getNodeParameter('prompt', i) as string;
	if (!prompt || prompt.trim() === '') {
		throw new NodeOperationError(this.getNode(), 'The prompt is empty', { itemIndex: i });
	}
	try {
		return buildChatBody({
			routingMode,
			pinnedModel,
			prompt,
			systemMessage: options.systemMessage,
			temperature: options.temperature,
			maxTokens: options.maxTokens,
			reasoningEffort: options.reasoningEffort,
			jsonOutput: options.jsonOutput,
		});
	} catch (error) {
		throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex: i });
	}
}

function runIndexOf(this: IExecuteFunctions, i: number): number {
	try {
		const value = this.getWorkflowDataProxy(i).$thisRunIndex as unknown;
		return typeof value === 'number' ? value : 0;
	} catch (error) {
		this.logger.debug(`AI Stupid Level: run index unavailable (${(error as Error).message})`);
		return 0;
	}
}

async function runRouterOperation(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject[]> {
	if (operation === 'previewRoute') {
		const options = this.getNodeParameter('options', i, {}) as ChatOptions;
		const simplify = this.getNodeParameter('simplify', i, true) as boolean;
		const body = chatBody.call(this, i, options);
		const response = await routerRequest.call(this, 'POST', '/route/preview', {
			body,
			headers: buildRouterHeaders({ sandbox: options.sandbox === true }),
		});
		return [mapRoutePreview(response.body, simplify)];
	}
	if (operation === 'getUsage') {
		const response = await routerRequest.call(this, 'GET', '/usage');
		return [response.body];
	}
	if (operation === 'sendFeedback') {
		const id = String(this.getNodeParameter('requestId', i) ?? '').trim();
		if (!id) {
			throw new NodeOperationError(this.getNode(), 'The request ID is empty', { itemIndex: i });
		}
		const rating = this.getNodeParameter('rating', i) as string;
		const response = await routerRequest.call(this, 'POST', '/router/feedback', {
			body: { id, rating },
		});
		return [{ requestId: id, rating, ...response.body }];
	}
	if (operation === 'listModels') {
		const includeModes = this.getNodeParameter('includeRoutingModes', i, true) as boolean;
		const response = await routerRequest.call(this, 'GET', '/models');
		const data = (response.body.data as IDataObject[] | undefined) ?? [];
		return data
			.map((m) => ({ ...m, routingMode: m.owned_by === 'aistupidlevel' }))
			.filter((m) => includeModes || !m.routingMode);
	}
	throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not supported`, {
		itemIndex: i,
	});
}

async function runBenchmarkOperation(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject[]> {
	const modelId = () => {
		try {
			return normalizeDataModelId(this.getNodeParameter('modelId', i));
		} catch (error) {
			throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex: i });
		}
	};
	const period = () => this.getNodeParameter('period', i, '24h') as string;

	switch (operation) {
		case 'getLeaderboard': {
			const sortBy = this.getNodeParameter('sortBy', i, 'combined') as string;
			const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
			const limit = this.getNodeParameter('limit', i, 50) as number;
			const simplify = this.getNodeParameter('simplify', i, true) as boolean;
			const body = await dataRequest.call(this, '/models', { period: period(), sortBy });
			let rows = toItemJson(unwrapEnvelope(body));
			if (simplify) rows = rows.map((row, index) => simplifyLeaderboardRow(row, index));
			return returnAll ? rows : rows.slice(0, limit);
		}
		case 'getModel': {
			const body = await dataRequest.call(this, `/models/${modelId()}`);
			return toItemJson(unwrapEnvelope(body));
		}
		case 'getModelHistory': {
			const id = modelId();
			const body = await dataRequest.call(this, `/models/${id}/history`, { period: period() });
			return toItemJson(unwrapEnvelope(body)).map((point) => ({ modelId: Number(id), ...point }));
		}
		case 'getDrift': {
			const body = await dataRequest.call(this, `/drift/${modelId()}`);
			return toItemJson(unwrapEnvelope(body));
		}
		case 'getIncidents': {
			const limit = this.getNodeParameter('limit', i, 50) as number;
			const body = await dataRequest.call(this, '/incidents', { limit });
			return toItemJson(unwrapEnvelope(body));
		}
		case 'getAlerts': {
			const body = await dataRequest.call(this, '/alerts');
			return toItemJson(unwrapEnvelope(body));
		}
		case 'getRecommendations': {
			const body = await dataRequest.call(this, '/analytics/recommendations', { period: period() });
			return toItemJson(unwrapEnvelope(body));
		}
		case 'getDegradations': {
			const body = await dataRequest.call(this, '/analytics/degradations', { period: period() });
			return toItemJson(unwrapEnvelope(body));
		}
		case 'getProviderReliability': {
			const body = await dataRequest.call(this, '/analytics/provider-reliability');
			return toItemJson(unwrapEnvelope(body));
		}
		case 'getProviderStatus': {
			const body = await dataRequest.call(this, '/providers');
			const data = unwrapEnvelope(body);
			if (data && typeof data === 'object' && !Array.isArray(data)) {
				return Object.entries(data as IDataObject).map(([provider, status]) => ({
					provider,
					...((status ?? {}) as IDataObject),
				}));
			}
			return toItemJson(data);
		}
		case 'getGlobalIndex': {
			const body = await dataRequest.call(this, '/index');
			return toItemJson(unwrapEnvelope(body));
		}
		default:
			throw new NodeOperationError(
				this.getNode(),
				`The operation "${operation}" is not supported`,
				{
					itemIndex: i,
				},
			);
	}
}
