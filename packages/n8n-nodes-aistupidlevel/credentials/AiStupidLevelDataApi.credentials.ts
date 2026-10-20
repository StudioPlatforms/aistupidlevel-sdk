import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class AiStupidLevelDataApi implements ICredentialType {
	name = 'aiStupidLevelDataApi';

	displayName = 'AI Stupid Level Data API';

	icon: Icon = {
		light: 'file:../icons/aistupidlevel.svg',
		dark: 'file:../icons/aistupidlevel.dark.svg',
	};

	documentationUrl =
		'https://github.com/StudioPlatforms/aistupidlevel-sdk/tree/main/packages/n8n-nodes-aistupidlevel#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Data API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'asl_live_...',
			description:
				'A Data API key (starts with asl_live_). Create one at https://aistupidlevel.info/account/data-keys. The free tier allows 10 requests a day, at most 1 a minute.',
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

	// GET /api/v1/me returns the key's tier and limits.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://aistupidlevel.info/api/v1',
			url: '/me',
			method: 'GET',
		},
	};
}
