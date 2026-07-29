/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { Event } from '../../../../util/vs/base/common/event';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { IAuthenticationService } from '../../../authentication/common/authentication';
import { IConfigurationService } from '../../../configuration/common/configurationService';
import { IEnvService } from '../../../env/common/envService';
import { IOctoKitService } from '../../../github/common/githubService';
import { ILogService } from '../../../log/common/logService';
import { IRequestLogger } from '../../../requestLogger/common/requestLogger';
import { IExperimentationService } from '../../../telemetry/common/nullExperimentationService';
import { ModelMetadataFetcher } from '../modelMetadataFetcher';

describe('ModelMetadataFetcher', () => {
	it('does not request GitHub authentication when no Copilot session exists', async () => {
		const getCopilotToken = vi.fn(async () => {
			throw new Error('GitHubLoginFailed');
		});
		const authenticationService = {
			copilotToken: undefined,
			onDidAuthenticationChange: Event.None,
			getCopilotToken
		} as unknown as IAuthenticationService;
		const logService = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn()
		} as unknown as ILogService;
		const fetcher = new ModelMetadataFetcher(
			false,
			{} as IOctoKitService,
			{} as IRequestLogger,
			{} as IConfigurationService,
			{} as IExperimentationService,
			{ isActive: true } as IEnvService,
			authenticationService,
			logService,
			{} as IInstantiationService
		);

		try {
			expect(await fetcher.getAllChatModels()).toEqual([]);
			expect(getCopilotToken).not.toHaveBeenCalled();
		} finally {
			fetcher.dispose();
		}
	});
});
