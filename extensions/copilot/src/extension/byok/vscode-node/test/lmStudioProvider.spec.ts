/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { DefaultsOnlyConfigurationService } from '../../../../platform/configuration/common/defaultsOnlyConfigurationService';
import { FetchOptions, HeadersImpl, IFetcherService, Response } from '../../../../platform/networking/common/fetcherService';
import { NullExperimentationService } from '../../../../platform/telemetry/common/nullExperimentationService';
import { TestLogService } from '../../../../platform/testing/common/testLogService';
import { mock } from '../../../../util/common/test/simpleMock';
import { InstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiationService';
import type { IBYOKStorageService } from '../byokStorageService';
import { LMStudioLMProvider } from '../lmStudioProvider';

class RecordingFetcherService extends mock<IFetcherService>() {
	public readonly requests: { url: string; options: FetchOptions }[] = [];

	constructor(private readonly responseBody: unknown) {
		super();
	}

	override fetch(url: string, options: FetchOptions): Promise<Response> {
		this.requests.push({ url, options });
		return Promise.resolve(Response.fromText(
			200,
			'OK',
			new HeadersImpl({ 'content-type': 'application/json' }),
			JSON.stringify(this.responseBody),
			'test-stub'
		));
	}
}

function createStorageService(): IBYOKStorageService {
	return {
		getAPIKey: async () => undefined,
		storeAPIKey: async () => undefined,
		deleteAPIKey: async () => undefined,
		getStoredModelConfigs: async () => ({}),
		saveModelConfig: async () => undefined,
		removeModelConfig: async () => undefined,
	};
}

describe('LMStudioLMProvider', () => {
	it('probes the local default without auth and keeps unknown model capabilities conservative', async () => {
		const fetcherService = new RecordingFetcherService({
			data: [{ id: 'unknown-local-model', context_length: 8192 }]
		});
		const instantiationService = new InstantiationService();
		const tokenSource = new vscode.CancellationTokenSource();
		const provider = new LMStudioLMProvider(
			createStorageService(),
			fetcherService,
			new TestLogService(),
			instantiationService,
			new DefaultsOnlyConfigurationService(),
			new NullExperimentationService()
		);

		try {
			const models = await provider.provideLanguageModelChatInformation({
				silent: true,
				configuration: undefined,
			}, tokenSource.token);

			expect(fetcherService.requests).toHaveLength(1);
			expect(fetcherService.requests[0]).toEqual({
				url: 'http://localhost:1234/v1/models',
				options: {
					method: 'GET',
					headers: { 'Content-Type': 'application/json' },
					callSite: 'byok-models-discovery',
					timeout: 1500,
				}
			});
			expect(models).toHaveLength(1);
			expect(models[0].id).toBe('unknown-local-model');
			expect(models[0].capabilities?.toolCalling).toBe(false);
			expect(models[0].capabilities?.imageInput).toBe(false);
		} finally {
			tokenSource.dispose();
			instantiationService.dispose();
		}
	});
});
