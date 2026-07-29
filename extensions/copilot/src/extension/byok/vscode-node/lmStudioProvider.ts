/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKModelCapabilities } from '../common/byokProvider';
import { OpenAIEndpoint } from '../node/openAIEndpoint';
import { AbstractOpenAICompatibleLMProvider, LanguageModelChatConfiguration, OpenAICompatibleLanguageModelChatInformation } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';

interface LMStudioModelData {
	id: string;
	object: string;
	owned_by: string;
	context_length?: number;
}

const LOCAL_PROVIDER_TIMEOUT = 1500;

export interface LMStudioConfig extends LanguageModelChatConfiguration {
	url: string;
}

export class LMStudioLMProvider extends AbstractOpenAICompatibleLMProvider<LMStudioConfig> {

	public static readonly providerName = 'LMStudio';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			LMStudioLMProvider.providerName.toLowerCase(),
			LMStudioLMProvider.providerName,
			undefined,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected override async getAllModels(silent: boolean, apiKey: string | undefined, configuration: LMStudioConfig | undefined): Promise<OpenAICompatibleLanguageModelChatInformation<LMStudioConfig>[]> {
		const resolvedConfiguration: LMStudioConfig = configuration ?
			{ authType: 'none', ...configuration } :
			{ authType: 'none', url: 'http://localhost:1234/v1' };
		return super.getAllModels(silent, apiKey, resolvedConfiguration);
	}

	protected override getModelDiscoveryTimeout(): number {
		return LOCAL_PROVIDER_TIMEOUT;
	}

	protected override getModelsBaseUrl(configuration: LMStudioConfig | undefined): string {
		const baseUrl = this.normalizeBaseUrl(configuration?.baseUrl ?? configuration?.url ?? 'http://localhost:1234/v1') ?? 'http://localhost:1234/v1';
		return /\/v\d+$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1`;
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		const lmStudioModel = modelData as LMStudioModelData;
		const contextLength = lmStudioModel.context_length ?? 32768;
		return {
			name: lmStudioModel.id,
			toolCalling: false,
			vision: false,
			maxInputTokens: contextLength - 4096,
			maxOutputTokens: contextLength < 4096 ? Math.floor(contextLength / 2) : 4096
		};
	}

	protected override async createOpenAIEndPoint(model: OpenAICompatibleLanguageModelChatInformation<LMStudioConfig>): Promise<OpenAIEndpoint> {
		const modelInfo = this.getModelInfo(model.id, model.url);
		modelInfo.authType = model.configuration?.authType ?? 'none';
		modelInfo.authHeaderName = model.configuration?.customHeaderName;
		const url = /\/v\d+$/i.test(model.url) ? `${model.url}/chat/completions` : `${model.url}/v1/chat/completions`;
		return this._instantiationService.createInstance(OpenAIEndpoint, modelInfo, model.configuration?.apiKey ?? '', url);
	}
}
