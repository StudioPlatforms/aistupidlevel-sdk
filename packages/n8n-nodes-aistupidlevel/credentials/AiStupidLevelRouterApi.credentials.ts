import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class AiStupidLevelRouterApi implements ICredentialType {
	name = 'aiStupidLevelRouterApi';

	displayName = 'AI Stupid Level Router API';

	icon: Icon = {
		light: 'file:../icons/aistupidlevel.svg',
		dark: 'file:../icons/aistupidlevel.dark.svg',
	};

	documentationUrl =
		'https://github.com/StudioPlatforms/aistupidlevel-sdk/tree/main/packages/n8n-nodes-aistupidlevel#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Router Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'aism_...',
			description:
				'A Smart Router key (starts with aism_). Create one at https://aistupidlevel.info/router/keys. Your own provider keys are added on the same site; the router answers with them.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// GET /v1/usage is free and is not counted as a routed request.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://aistupidlevel.info/v1',
			url: '/usage',
			method: 'GET',
		},
	};
}
