import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
} from 'n8n-workflow';

import {
	CLIENT_HEADER,
	DATA_API_BASE_URL,
	DATA_CREDENTIAL,
	ROUTER_BASE_URL,
	ROUTER_CREDENTIAL,
} from './constants';

type RequestContext = IExecuteFunctions | ILoadOptionsFunctions;

export interface FullResponse {
	body: IDataObject;
	headers: IDataObject;
	statusCode: number;
}

/** One call to the Smart Router (https://aistupidlevel.info/v1), authenticated with the router key. */
export async function routerRequest(
	this: RequestContext,
	method: IHttpRequestMethods,
	path: string,
	options: { body?: IDataObject; headers?: Record<string, string>; timeout?: number } = {},
): Promise<FullResponse> {
	const request: IHttpRequestOptions = {
		method,
		baseURL: ROUTER_BASE_URL,
		url: path,
		headers: { Accept: 'application/json', 'X-ASL-Client': CLIENT_HEADER, ...options.headers },
		json: true,
		returnFullResponse: true,
	};
	if (options.body !== undefined) request.body = options.body;
	if (options.timeout !== undefined) request.timeout = options.timeout;
	const response = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		ROUTER_CREDENTIAL,
		request,
	)) as FullResponse;
	return response;
}

/** One call to the Data API (https://aistupidlevel.info/api/v1), authenticated with the data key. */
export async function dataRequest(
	this: IExecuteFunctions,
	path: string,
	qs: IDataObject = {},
): Promise<IDataObject> {
	const request: IHttpRequestOptions = {
		method: 'GET',
		baseURL: DATA_API_BASE_URL,
		url: path,
		qs,
		headers: { Accept: 'application/json', 'X-ASL-Client': CLIENT_HEADER },
		json: true,
	};
	return (await this.helpers.httpRequestWithAuthentication.call(
		this,
		DATA_CREDENTIAL,
		request,
	)) as IDataObject;
}

/** The models a request can be pinned to (GET /v1/models without the routing modes). */
export async function getRoutableModels(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const { body } = await routerRequest.call(this, 'GET', '/models');
	const data = (body.data as IDataObject[] | undefined) ?? [];
	return data
		.filter((m) => typeof m.id === 'string' && m.owned_by !== 'aistupidlevel')
		.map((m) => ({
			name: m.id as string,
			value: m.id as string,
			description: typeof m.owned_by === 'string' ? `Provider: ${m.owned_by}` : undefined,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}
