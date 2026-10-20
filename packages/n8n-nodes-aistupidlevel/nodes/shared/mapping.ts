import { createHash } from 'crypto';

import type { IDataObject } from 'n8n-workflow';

import { CLIENT_HEADER, PINNED_MODE } from './constants';

export interface ChatInput {
	routingMode: string;
	pinnedModel?: string;
	prompt: string;
	systemMessage?: string;
	temperature?: number;
	maxTokens?: number;
	reasoningEffort?: string;
	jsonOutput?: boolean;
}

/** The "model" field of a request: a routing mode, or the pinned model id. */
export function resolveModel(routingMode: string, pinnedModel?: string): string {
	if (routingMode === PINNED_MODE) {
		const model = (pinnedModel ?? '').trim();
		if (!model) {
			throw new Error('Choose the model to pin, or pick a routing mode instead of "Pin a Model"');
		}
		return model;
	}
	return routingMode || 'auto';
}

/** Request body for POST /v1/chat/completions and POST /v1/route/preview. */
export function buildChatBody(input: ChatInput): IDataObject {
	const messages: IDataObject[] = [];
	if (input.systemMessage && input.systemMessage.trim() !== '') {
		messages.push({ role: 'system', content: input.systemMessage });
	}
	messages.push({ role: 'user', content: input.prompt });

	const body: IDataObject = {
		model: resolveModel(input.routingMode, input.pinnedModel),
		messages,
	};
	if (typeof input.temperature === 'number') body.temperature = input.temperature;
	if (typeof input.maxTokens === 'number' && input.maxTokens > 0) body.max_tokens = input.maxTokens;
	if (input.reasoningEffort) body.reasoning_effort = input.reasoningEffort;
	if (input.jsonOutput) body.response_format = { type: 'json_object' };
	return body;
}

/** Headers every router request carries; the key itself is added by the credential. */
export function buildRouterHeaders(options: {
	sandbox?: boolean;
	idempotencyKey?: string;
}): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: 'application/json',
		'X-ASL-Client': CLIENT_HEADER,
	};
	if (options.sandbox) headers['X-ASL-Sandbox'] = 'true';
	if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
	return headers;
}

/**
 * An Idempotency-Key for one routed request. It is the same for every attempt of one item in one
 * node run with the same body (so n8n's "Retry On Fail" never pays twice for an answer whose
 * response was lost) and different for anything else: the instance id keeps two n8n installations
 * that share a workflow apart, and the body hash keeps a different request (another prompt in a
 * loop, another tool call) from ever being answered with a stored reply.
 */
export function buildIdempotencyKey(parts: {
	instanceId: string;
	executionId: string;
	nodeId: string;
	runIndex: number;
	itemIndex: number;
	body: IDataObject;
}): string {
	const clean = (s: string) =>
		String(s ?? '')
			.replace(/[^\x21-\x7e]/g, '')
			.slice(0, 64);
	const bodyHash = createHash('sha256')
		.update(JSON.stringify(parts.body))
		.digest('hex')
		.slice(0, 24);
	return [
		'n8n',
		clean(parts.instanceId) || 'instance',
		clean(parts.executionId),
		clean(parts.nodeId) || 'node',
		String(parts.runIndex),
		String(parts.itemIndex),
		bodyHash,
	]
		.join('-')
		.slice(0, 255);
}

export interface RoutingInfo extends IDataObject {
	model: string | null;
	provider: string | null;
	reason: string | null;
	latencyMs: number | null;
	requestId: string | null;
	sandbox: boolean;
	fallback: boolean;
	replayed: boolean;
}

/** The routing decision, read from the X-AISM-* response headers. */
export function routingFromHeaders(headers: IDataObject | undefined): RoutingInfo {
	const lower: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers ?? {})) {
		if (v === undefined || v === null) continue;
		lower[k.toLowerCase()] = Array.isArray(v) ? String(v[0]) : String(v);
	}
	const get = (name: string): string | null => lower[name] ?? null;
	const reason = get('x-aism-reasoning');
	const latency = get('x-aism-latency');
	return {
		model: get('x-aism-model'),
		provider: get('x-aism-provider'),
		reason,
		latencyMs:
			latency !== null && latency !== '' && !Number.isNaN(Number(latency)) ? Number(latency) : null,
		requestId: get('x-aism-request-id'),
		sandbox: get('x-aism-sandbox') === 'true',
		fallback: !!reason && /fallback activated/i.test(reason),
		replayed: get('idempotent-replayed') === 'true',
	};
}

/** The text of the first choice. */
export function answerText(completion: IDataObject): string {
	const choices = completion.choices as IDataObject[] | undefined;
	const message = (choices?.[0]?.message ?? {}) as IDataObject;
	const content = message.content;
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => (typeof part === 'string' ? part : String((part as IDataObject).text ?? '')))
			.join('');
	}
	return '';
}

/** Parses a JSON answer, tolerating a Markdown code fence around it. */
export function parseJsonAnswer(text: string): {
	value?: IDataObject | IDataObject[];
	error?: string;
} {
	const trimmed = text
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/, '');
	try {
		const value = JSON.parse(trimmed) as unknown;
		if (value !== null && typeof value === 'object') {
			return { value: value as IDataObject | IDataObject[] };
		}
		return { error: 'The answer is JSON but not an object or array' };
	} catch (error) {
		return { error: `The answer is not valid JSON: ${(error as Error).message}` };
	}
}

/** The node's output for a chat completion. */
export function mapCompletion(
	completion: IDataObject,
	headers: IDataObject | undefined,
	options: { simplify: boolean; jsonOutput: boolean },
): IDataObject {
	const routing = routingFromHeaders(headers);
	// The completion's own model field names the model that answered; the header is preferred.
	if (!routing.model && typeof completion.model === 'string') routing.model = completion.model;
	if (!routing.requestId && typeof completion.id === 'string') routing.requestId = completion.id;

	const answer = answerText(completion);
	const choices = completion.choices as IDataObject[] | undefined;
	const first = (choices?.[0] ?? {}) as IDataObject;
	const message = (first.message ?? {}) as IDataObject;

	let parsed: { value?: IDataObject | IDataObject[]; error?: string } = {};
	if (options.jsonOutput) parsed = parseJsonAnswer(answer);

	if (!options.simplify) {
		const out: IDataObject = { ...completion, routing };
		if (options.jsonOutput) {
			if (parsed.value !== undefined) out.answerJson = parsed.value;
			if (parsed.error) out.answerJsonError = parsed.error;
		}
		return out;
	}

	const out: IDataObject = { answer };
	if (options.jsonOutput) {
		if (parsed.value !== undefined) out.answerJson = parsed.value;
		if (parsed.error) out.answerJsonError = parsed.error;
	}
	Object.assign(out, {
		model: routing.model,
		provider: routing.provider,
		routingReason: routing.reason,
		requestId: routing.requestId,
		finishReason: first.finish_reason ?? null,
		usage: completion.usage ?? null,
		latencyMs: routing.latencyMs,
		sandbox: routing.sandbox,
		fallback: routing.fallback,
	});
	if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
		out.toolCalls = message.tool_calls;
	}
	if (typeof message.refusal === 'string' && message.refusal) out.refusal = message.refusal;
	if (routing.replayed) out.replayed = true;
	return out;
}

/** The node's output for a route preview. */
export function mapRoutePreview(preview: IDataObject, simplify: boolean): IDataObject {
	if (!simplify) return preview;
	const primary = (preview.primary ?? {}) as IDataObject;
	const fallbacks = ((preview.fallbacks as IDataObject[] | undefined) ?? []).map((f) => ({
		model: f.model ?? null,
		provider: f.provider ?? null,
		score: f.score ?? null,
		estimatedCostUsd: f.estimated_cost_usd ?? null,
	}));
	return {
		requestedModel: preview.requested_model ?? null,
		strategy: preview.strategy ?? null,
		model: primary.model ?? null,
		provider: primary.provider ?? null,
		score: primary.score ?? null,
		routingReason: primary.reasoning ?? null,
		estimatedCostUsd: primary.estimated_cost_usd ?? null,
		fallbackEnabled: preview.fallback_enabled ?? null,
		fallbacks,
		sandbox: preview.sandbox ?? false,
	};
}

/** The "data" of a Data API envelope ({ success, version, generated_at, license, ..., data }). */
export function unwrapEnvelope(body: unknown): unknown {
	if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in (body as IDataObject)) {
		return (body as IDataObject).data;
	}
	return body;
}

/** One leaderboard row with the fields most workflows need. */
export function simplifyLeaderboardRow(row: IDataObject, index: number): IDataObject {
	return {
		position: index + 1,
		id: row.id ?? null,
		model: row.name ?? null,
		displayName: row.displayName ?? row.name ?? null,
		provider: row.provider ?? row.vendor ?? null,
		score: row.currentScore ?? row.score ?? null,
		confidenceLower: row.confidenceLower ?? null,
		confidenceUpper: row.confidenceUpper ?? null,
		trend: row.trend ?? null,
		status: row.status ?? null,
		stale: row.isStale ?? null,
		suites: row.suites ?? null,
		lastUpdated: row.lastUpdated ?? null,
	};
}

/**
 * Splits a Data API payload into items: an array becomes one item per element (each an object),
 * anything else becomes one item.
 */
export function toItemJson(data: unknown): IDataObject[] {
	if (Array.isArray(data)) {
		return data.map((entry) =>
			entry !== null && typeof entry === 'object' && !Array.isArray(entry)
				? (entry as IDataObject)
				: ({ value: entry } as IDataObject),
		);
	}
	if (data !== null && typeof data === 'object') return [data as IDataObject];
	return [{ value: data as string | number | boolean | null } as IDataObject];
}

/** A Data API model id is the numeric id from the leaderboard (for example 292). */
export function normalizeDataModelId(value: unknown): string {
	const id = String(value ?? '').trim();
	if (!/^\d{1,9}$/.test(id)) {
		throw new Error(
			`"${id}" is not a model ID. Use the numeric "id" from Get Leaderboard (for example 292), not the model name.`,
		);
	}
	return id;
}
