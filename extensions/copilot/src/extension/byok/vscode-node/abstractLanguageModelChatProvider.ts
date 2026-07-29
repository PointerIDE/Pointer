/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, ChatLocation, commands, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelChatProvider, LanguageModelResponsePart2, l10n, PrepareLanguageModelChatModelOptions, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IChatModelInformation, ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IStringDictionary } from '../../../util/vs/base/common/collections';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { CopilotLanguageModelWrapper } from '../../conversation/vscode-node/languageModelAccess';
import { BYOKAuthType, BYOKKnownModels, byokKnownModelsToAPIInfo, BYOKModelCapabilities, inferBYOKModelCapabilities, resolveModelInfo } from '../common/byokProvider';
import { OpenAIEndpoint } from '../node/openAIEndpoint';
import { IBYOKStorageService } from './byokStorageService';

export interface LanguageModelChatConfiguration {
	readonly enabled?: boolean;
	readonly apiKey?: string;
	readonly url?: string;
	readonly baseUrl?: string;
	readonly apiPath?: string;
	readonly authType?: 'bearer' | 'header' | 'none';
	readonly customHeaderName?: string;
	readonly additionalHeaders?: string;
	readonly requestTimeout?: number;
	readonly modelsFetchUrl?: string;
	readonly modelFetchUrl?: string;
	readonly cachedModels?: readonly CachedLanguageModelConfiguration[];
	readonly manualModels?: readonly string[];
	readonly defaultChatModel?: string;
	readonly defaultCodingModel?: string;
	readonly fastModel?: string;
}

const MIN_REQUEST_TIMEOUT = 250;
const MAX_REQUEST_TIMEOUT = 120000;
const MAX_ADDITIONAL_HEADER_COUNT = 20;
const VALID_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/;
const RESERVED_ADDITIONAL_HEADERS: ReadonlySet<string> = new Set([
	'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
	'connection', 'content-length', 'cookie', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin',
	'permissions-policy', 'referer', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'user-agent', 'via',
	'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'api-key', 'authorization',
	'content-type', 'openai-intent', 'x-github-api-version', 'x-initiator', 'x-interaction-id',
	'x-interaction-type', 'x-onbehalf-extension-id', 'x-request-id', 'x-vscode-user-agent-library-version'
]);

export function resolveRequestTimeout(value: unknown, fallback: number): number {
	if (value === undefined) {
		return fallback;
	}
	if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_REQUEST_TIMEOUT || value > MAX_REQUEST_TIMEOUT) {
		throw new Error(l10n.t('Request timeout must be a whole number between {0} and {1} milliseconds.', MIN_REQUEST_TIMEOUT, MAX_REQUEST_TIMEOUT));
	}
	return value;
}

export function parseAdditionalHeaders(value: string | undefined): IStringDictionary<string> {
	const headers: IStringDictionary<string> = {};
	if (!value?.trim()) {
		return headers;
	}
	if (/[\r\n]/.test(value)) {
		throw new Error(l10n.t('Additional headers must use semicolons between entries.'));
	}

	const entries = value.split(';').map(entry => entry.trim()).filter(entry => !!entry);
	if (entries.length > MAX_ADDITIONAL_HEADER_COUNT) {
		throw new Error(l10n.t('No more than {0} additional headers are allowed.', MAX_ADDITIONAL_HEADER_COUNT));
	}

	for (const entry of entries) {
		const separator = entry.indexOf(':');
		const name = separator > 0 ? entry.slice(0, separator).trim() : '';
		const headerValue = separator > 0 ? entry.slice(separator + 1).trim() : '';
		const lowerName = name.toLowerCase();
		if (!name || !headerValue || name.length > 256 || headerValue.length > 8192 ||
			!VALID_HEADER_NAME_PATTERN.test(name) || /[\x00-\x1F\x7F\u200B-\u200D\u202A-\u202E\uFEFF]/.test(headerValue) ||
			RESERVED_ADDITIONAL_HEADERS.has(lowerName) || lowerName.startsWith('proxy-') || lowerName.startsWith('sec-') ||
			lowerName.startsWith('x-http-method') || lowerName === 'x-method-override') {
			throw new Error(l10n.t('An additional header is invalid or reserved.'));
		}
		headers[name] = headerValue;
	}

	return headers;
}

export interface ExtendedLanguageModelChatInformation<C extends LanguageModelChatConfiguration> extends LanguageModelChatInformation {
	readonly configuration?: C;
}

export interface CachedLanguageModelConfiguration extends Partial<BYOKModelCapabilities> {
	readonly id: string;
	readonly name?: string;
}

export abstract class AbstractLanguageModelChatProvider<C extends LanguageModelChatConfiguration = LanguageModelChatConfiguration, T extends ExtendedLanguageModelChatInformation<C> = ExtendedLanguageModelChatInformation<C>> implements LanguageModelChatProvider<T> {

	constructor(
		protected readonly _id: string,
		protected readonly _name: string,
		protected _knownModels: BYOKKnownModels | undefined,
		protected readonly _byokStorageService: IBYOKStorageService,
		@ILogService protected readonly _logService: ILogService,
	) {
		this.configureDefaultGroupWithApiKeyOnly();
	}

	// TODO: Remove this after 6 months
	protected async configureDefaultGroupWithApiKeyOnly(): Promise<string | undefined> {
		const apiKey = await this._byokStorageService.getAPIKey(this._name);
		if (apiKey) {
			this.configureDefaultGroupIfExists(this._name, { apiKey } as C);
			await this._byokStorageService.deleteAPIKey(this._name, BYOKAuthType.GlobalApiKey);
		}
		return apiKey;
	}

	protected async configureDefaultGroupIfExists(name: string, configuration: C): Promise<void> {
		await commands.executeCommand('lm.migrateLanguageModelsProviderGroup', { vendor: this._id, name, ...configuration });
	}

	async provideLanguageModelChatInformation({ silent, configuration }: PrepareLanguageModelChatModelOptions, token: CancellationToken): Promise<T[]> {
		const typedConfiguration = configuration as C | undefined;
		if (typedConfiguration?.enabled === false) {
			return [];
		}

		let apiKey: string | undefined = typedConfiguration?.apiKey;
		if (!apiKey) {
			apiKey = await this.configureDefaultGroupWithApiKeyOnly();
		}

		const models = await this.getAllModels(silent, apiKey, typedConfiguration);
		return models.map(model => ({
			...model,
			apiKey,
				configuration: typedConfiguration
		}));
	}

	abstract provideLanguageModelChatResponse(model: T, messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>, options: ProvideLanguageModelChatResponseOptions, progress: Progress<LanguageModelResponsePart2>, token: CancellationToken): Promise<void>;
	abstract provideTokenCount(model: T, text: string | LanguageModelChatMessage | LanguageModelChatMessage2, token: CancellationToken): Promise<number>;
	protected abstract getAllModels(silent: boolean, apiKey: string | undefined, configuration: C | undefined): Promise<T[]>;
}

export interface OpenAICompatibleLanguageModelChatInformation<C extends LanguageModelChatConfiguration> extends ExtendedLanguageModelChatInformation<C> {
	url: string;
}

export abstract class AbstractOpenAICompatibleLMProvider<T extends LanguageModelChatConfiguration = LanguageModelChatConfiguration> extends AbstractLanguageModelChatProvider<T, OpenAICompatibleLanguageModelChatInformation<T>> {
	protected readonly _lmWrapper: CopilotLanguageModelWrapper;

	constructor(
		id: string,
		name: string,
		knownModels: BYOKKnownModels | undefined,
		byokStorageService: IBYOKStorageService,
		@IFetcherService protected readonly _fetcherService: IFetcherService,
		logService: ILogService,
		@IInstantiationService protected readonly _instantiationService: IInstantiationService,
		@IConfigurationService protected readonly _configurationService: IConfigurationService,
		@IExperimentationService protected readonly _expService: IExperimentationService
	) {
		super(id, name, knownModels, byokStorageService, logService);
		this._lmWrapper = this._instantiationService.createInstance(CopilotLanguageModelWrapper);
	}

	async provideLanguageModelChatResponse(model: OpenAICompatibleLanguageModelChatInformation<T>, messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>, options: ProvideLanguageModelChatResponseOptions, progress: Progress<LanguageModelResponsePart2>, token: CancellationToken): Promise<void> {
		const openAIChatEndpoint = await this.createOpenAIEndPoint(model);
		return this._lmWrapper.provideLanguageModelResponse(openAIChatEndpoint, messages, options, options.requestInitiator, progress, token);
	}

	async provideTokenCount(model: OpenAICompatibleLanguageModelChatInformation<T>, text: string | LanguageModelChatMessage | LanguageModelChatMessage2, token: CancellationToken): Promise<number> {
		const openAIChatEndpoint = await this.createOpenAIEndPoint(model);
		return this._lmWrapper.provideTokenCount(openAIChatEndpoint, text);
	}

	protected async getAllModels(silent: boolean, apiKey: string | undefined, configuration: T | undefined): Promise<OpenAICompatibleLanguageModelChatInformation<T>[]> {
		if (!configuration && silent) {
			return [];
		}
		const modelsUrl = this.normalizeBaseUrl(this.getModelsBaseUrl(configuration));
		const cachedModels = this.getKnownModelsFromConfiguration(configuration);
		if (modelsUrl) {
			try {
				const discoveredModels = await this.getModelsFromEndpoint(modelsUrl, silent, apiKey, configuration);
				const models = this.mergeDiscoveredAndConfiguredModels(discoveredModels, cachedModels);
				return this.toOpenAICompatibleModels(models, modelsUrl, configuration);
			} catch (error) {
				this._logService.error(error, `Error fetching available ${this._name} models`);
				if (Object.keys(cachedModels).length > 0) {
					return this.toOpenAICompatibleModels(cachedModels, modelsUrl, configuration);
				}
				throw error;
			}
		}
		return this.toOpenAICompatibleModels(cachedModels, '', configuration);
	}

	private mergeDiscoveredAndConfiguredModels(discoveredModels: BYOKKnownModels, configuredModels: BYOKKnownModels): BYOKKnownModels {
		const models: BYOKKnownModels = { ...discoveredModels };
		for (const [id, capabilities] of Object.entries(configuredModels)) {
			if (!models[id]) {
				models[id] = capabilities;
			}
		}
		return models;
	}

	private async getModelsFromEndpoint(endpoint: string, silent: boolean, apiKey: string | undefined, configuration: T | undefined): Promise<BYOKKnownModels> {
		const authType = configuration?.authType ?? (apiKey ? 'bearer' : 'none');
		if (!apiKey && authType !== 'none' && silent) {
			return {};
		}

		try {
			const headers = this.getModelDiscoveryHeaders(apiKey, configuration);

			const modelsEndpoint = this.getModelDiscoveryUrl(configuration, endpoint);
			const response = await this._fetcherService.fetch(modelsEndpoint, {
				method: 'GET',
				headers,
				callSite: 'byok-models-discovery',
				timeout: this.getModelDiscoveryTimeout(configuration),
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} ${response.statusText}`);
			}
			const data = await response.json();
			const modelList: BYOKKnownModels = {};

			const models = this.extractModelList(data);
			if (!models || !Array.isArray(models)) {
				throw new Error('Invalid response format');
			}
			if (models.length === 0) {
				throw new Error('Empty models list');
			}

			for (const model of models) {
				const modelId = this.getModelIdentifier(model);
				if (!modelId) {
					continue;
				}
				let modelCapabilities = this._knownModels?.[modelId];
				if (!modelCapabilities) {
					modelCapabilities = this.resolveModelCapabilities(model);
					if (!modelCapabilities) {
						modelCapabilities = this.getDefaultModelCapabilities(modelId);
					}
					if (!this._knownModels) {
						this._knownModels = {};
					}
					this._knownModels[modelId] = modelCapabilities;
				}
				modelList[modelId] = modelCapabilities;
			}
			if (Object.keys(modelList).length === 0) {
				throw new Error('Empty models list');
			}
			return modelList;
		} catch (error) {
			this._logService.error(error, `Error fetching available ${this._name} models`);
			throw error;
		}
	}

	protected getModelDiscoveryTimeout(configuration: T | undefined): number {
		return resolveRequestTimeout(configuration?.requestTimeout, 15000);
	}

	protected async createOpenAIEndPoint(model: OpenAICompatibleLanguageModelChatInformation<T>): Promise<OpenAIEndpoint> {
		const modelInfo = this.getModelInfo(model.id, model.url);
		modelInfo.authType = model.configuration?.authType ?? (model.configuration?.apiKey ? 'bearer' : 'none');
		modelInfo.authHeaderName = model.configuration?.customHeaderName;
		modelInfo.requestHeaders = { ...modelInfo.requestHeaders, ...parseAdditionalHeaders(model.configuration?.additionalHeaders) };
		if (model.configuration?.requestTimeout !== undefined) {
			modelInfo.requestTimeout = resolveRequestTimeout(model.configuration.requestTimeout, 15000);
		}
		const url = modelInfo.supported_endpoints?.includes(ModelSupportedEndpoint.Responses) ?
			`${model.url}/responses` :
			`${model.url}/chat/completions`;
		return this._instantiationService.createInstance(OpenAIEndpoint, modelInfo, model.configuration?.apiKey ?? '', url);
	}

	protected getModelInfo(modelId: string, modelUrl: string): IChatModelInformation {
		return resolveModelInfo(modelId, this._name, this._knownModels);
	}

	protected resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		if (typeof modelData !== 'object' || !modelData) {
			return undefined;
		}
		const modelId = (modelData as { id?: unknown }).id;
		if (typeof modelId !== 'string' || !modelId) {
			return undefined;
		}
		return inferBYOKModelCapabilities(modelId, modelData);
	}

	protected abstract getModelsBaseUrl(configuration: T | undefined): string | undefined;

	protected getModelsDiscoveryUrl(modelsBaseUrl: string): string {
		const discoveryBaseUrl = modelsBaseUrl.replace(/\/(?:chat\/completions|responses)$/, '');
		if (/[/?#]models(?:[/?#]|$)/.test(discoveryBaseUrl)) {
			return discoveryBaseUrl;
		}
		return `${discoveryBaseUrl}/models`;
	}

	protected getModelDiscoveryUrl(configuration: T | undefined, modelsBaseUrl: string): string {
		return this.normalizeBaseUrl(configuration?.modelsFetchUrl ?? configuration?.modelFetchUrl) ?? this.getModelsDiscoveryUrl(modelsBaseUrl);
	}

	private getModelDiscoveryHeaders(apiKey: string | undefined, configuration: T | undefined): IStringDictionary<string> {
		const headers: IStringDictionary<string> = {
			'Content-Type': 'application/json'
		};
		const authType = configuration?.authType ?? (apiKey ? 'bearer' : 'none');
		if (apiKey && authType === 'header') {
			headers[configuration?.customHeaderName || 'api-key'] = apiKey;
		} else if (apiKey && authType === 'bearer') {
			headers['Authorization'] = `Bearer ${apiKey}`;
		}
		for (const [name, value] of Object.entries(parseAdditionalHeaders(configuration?.additionalHeaders))) {
			if (!Object.keys(headers).some(existingName => existingName.toLowerCase() === name.toLowerCase())) {
				headers[name] = value;
			}
		}
		return headers;
	}

	private getKnownModelsFromConfiguration(configuration: T | undefined): BYOKKnownModels {
		const models: BYOKKnownModels = {};
		for (const cached of configuration?.cachedModels ?? []) {
			if (!cached.id) {
				continue;
			}
			models[cached.id] = {
				name: cached.name ?? cached.id,
				maxInputTokens: cached.maxInputTokens ?? 100000,
				maxOutputTokens: cached.maxOutputTokens ?? 8192,
				toolCalling: cached.toolCalling ?? false,
				vision: cached.vision ?? false,
				thinking: cached.thinking,
				adaptiveThinking: cached.adaptiveThinking,
				streaming: cached.streaming,
				editTools: cached.editTools,
				requestHeaders: cached.requestHeaders,
				supportedEndpoints: cached.supportedEndpoints,
				zeroDataRetentionEnabled: cached.zeroDataRetentionEnabled,
				supportsReasoningEffort: cached.supportsReasoningEffort
			};
		}
		for (const id of configuration?.manualModels ?? []) {
			if (id && !models[id]) {
				models[id] = this.getDefaultModelCapabilities(id);
			}
		}
		return models;
	}

	private getDefaultModelCapabilities(modelId: string): BYOKModelCapabilities {
		return this._knownModels?.[modelId] ?? {
			name: modelId,
			maxInputTokens: 128000,
			maxOutputTokens: 8192,
			toolCalling: false,
			vision: false,
			streaming: true
		};
	}

	private toOpenAICompatibleModels(models: BYOKKnownModels, url: string, configuration: T | undefined): OpenAICompatibleLanguageModelChatInformation<T>[] {
		return byokKnownModelsToAPIInfo(this._name, models).map(model => ({
			...model,
			isDefault: this.getModelDefaults(model.id, configuration),
			url
		}));
	}

	private getModelDefaults(modelId: string, configuration: T | undefined): Record<ChatLocation, boolean> | undefined {
		const defaults: Partial<Record<ChatLocation, boolean>> = {};
		if (configuration?.defaultChatModel === modelId) {
			defaults[ChatLocation.Panel] = true;
		}
		if (configuration?.defaultCodingModel === modelId) {
			defaults[ChatLocation.Editor] = true;
		}
		return Object.keys(defaults).length > 0 ? defaults as Record<ChatLocation, boolean> : undefined;
	}

	protected normalizeBaseUrl(url: string | undefined): string | undefined {
		const trimmed = url?.trim();
		if (!trimmed) {
			return undefined;
		}
		return trimmed.replace(/\/+$/, '');
	}

	protected extractModelList(data: unknown): unknown[] | undefined {
		if (Array.isArray(data)) {
			return data;
		}
		if (!data || typeof data !== 'object') {
			return undefined;
		}

		const candidate = data as {
			data?: unknown;
			models?: unknown;
			items?: unknown;
		};

		if (Array.isArray(candidate.data)) {
			return candidate.data;
		}
		if (Array.isArray(candidate.models)) {
			return candidate.models;
		}
		if (Array.isArray(candidate.items)) {
			return candidate.items;
		}
		if (candidate.data && typeof candidate.data === 'object') {
			const nested = candidate.data as { models?: unknown; items?: unknown };
			if (Array.isArray(nested.models)) {
				return nested.models;
			}
			if (Array.isArray(nested.items)) {
				return nested.items;
			}
		}

		return undefined;
	}

	protected getModelIdentifier(model: unknown): string | undefined {
		if (!model || typeof model !== 'object') {
			return undefined;
		}
		const candidate = model as { id?: unknown; name?: unknown };
		if (typeof candidate.id === 'string' && candidate.id.trim()) {
			return candidate.id.trim();
		}
		if (typeof candidate.name === 'string' && candidate.name.trim()) {
			return candidate.name.trim();
		}
		return undefined;
	}

}
