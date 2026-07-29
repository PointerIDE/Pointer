/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Disposable, LanguageModelChatInformation, LanguageModelDataPart, LanguageModelTextPart, LanguageModelThinkingPart, LanguageModelToolCallPart, LanguageModelToolResultPart } from 'vscode';
import { CopilotToken } from '../../../platform/authentication/common/copilotToken';
import { ICAPIClientService } from '../../../platform/endpoint/common/capiClient';
import { EndpointEditToolName, IChatModelInformation, ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';
import { TokenizerType } from '../../../util/common/tokenizer';

export const enum BYOKAuthType {
	/**
	 * Requires a single API key for all models (e.g., OpenAI)
	 */
	GlobalApiKey,
	/**
	 * Requires both deployment URL and API key per model (e.g., Azure)
	 */
	PerModelDeployment,
	/**
	 * No authentication required (e.g., Ollama)
	 */
	None
}

interface BYOKBaseModelConfig {
	modelId: string;
	capabilities?: BYOKModelCapabilities;
}

export type LMResponsePart = LanguageModelTextPart | LanguageModelToolCallPart | LanguageModelDataPart | LanguageModelThinkingPart | LanguageModelToolResultPart;

export interface BYOKGlobalKeyModelConfig extends BYOKBaseModelConfig {
	apiKey: string;
}

export interface BYOKPerModelConfig extends BYOKBaseModelConfig {
	apiKey: string;
	deploymentUrl: string;
}

interface BYOKNoAuthModelConfig extends BYOKBaseModelConfig {
	// No additional fields required
}

export type BYOKModelConfig = BYOKGlobalKeyModelConfig | BYOKPerModelConfig | BYOKNoAuthModelConfig;

export interface BYOKModelCapabilities {
	name: string;
	url?: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	toolCalling: boolean;
	vision: boolean;
	thinking?: boolean;
	adaptiveThinking?: boolean;
	streaming?: boolean;
	editTools?: EndpointEditToolName[];
	requestHeaders?: Record<string, string>;
	supportedEndpoints?: ModelSupportedEndpoint[];
	zeroDataRetentionEnabled?: boolean;
	supportsReasoningEffort?: string[];
}

export interface BYOKModelRegistry {
	readonly name: string;
	readonly authType: BYOKAuthType;
	updateKnownModelsList(knownModels: BYOKKnownModels | undefined): void;
	getAllModels(apiKey?: string): Promise<{ id: string; name: string }[]>;
	registerModel(config: BYOKModelConfig): Promise<Disposable>;
}

// Many model providers don't have robust model lists. This allows us to map id -> information about models, and then if we don't know the model just let the user enter a custom id
export type BYOKKnownModels = Record<string, BYOKModelCapabilities>;

export function inferBYOKModelCapabilities(modelId: string, modelData?: unknown): BYOKModelCapabilities {
	const lowerId = modelId.toLowerCase();
	const data = isRecord(modelData) ? modelData : undefined;
	const architecture = isRecord(data?.architecture) ? data.architecture : undefined;
	const topProvider = isRecord(data?.top_provider) ? data.top_provider : undefined;
	const modalities = [
		...readStringArray(data?.modalities),
		...readStringArray(data?.input_modalities),
		...readStringArray(architecture?.input_modalities),
		...(typeof architecture?.modality === 'string' ? [architecture.modality] : []),
	].map(value => value.toLowerCase());

	const maxInputTokens =
		readPositiveNumber(data?.maxInputTokens) ??
		readPositiveNumber(data?.max_input_tokens) ??
		readPositiveNumber(data?.max_context_length) ??
		readPositiveNumber(data?.context_length) ??
		readPositiveNumber(data?.context_window) ??
		readPositiveNumber(data?.input_token_limit) ??
		readPositiveNumber(topProvider?.context_length) ??
		inferContextWindow(lowerId);

	const maxOutputTokens =
		readPositiveNumber(data?.maxOutputTokens) ??
		readPositiveNumber(data?.max_output_tokens) ??
		readPositiveNumber(data?.max_completion_tokens) ??
		readPositiveNumber(data?.output_token_limit) ??
		inferMaxOutputTokens(lowerId);

	const isNonChatModel = includesAny(lowerId, ['embedding', 'embed', 'whisper', 'tts', 'moderation', 'rerank', 'text-to-speech', 'speech-to-text']);
	const toolCalling = !isNonChatModel;
	const vision = modalities.includes('image') || modalities.includes('multimodal') || includesAny(lowerId, ['vision', 'vl', 'llava', 'pixtral', 'gpt-4o', 'omni', 'gemini', 'claude-3']);
	const thinking = includesAny(lowerId, ['o1', 'o3', 'o4', 'reasoning', 'deepseek-r1', 'qwen3', 'claude-3.7', 'claude-4', 'gemini-2.5']);
	const supportsResponses = includesAny(lowerId, ['gpt-4.1', 'gpt-4o', 'gpt-5', 'o1', 'o3', 'o4']);

	return {
		name: readDisplayName(modelId, data),
		maxInputTokens,
		maxOutputTokens,
		toolCalling,
		vision,
		thinking,
		adaptiveThinking: thinking || undefined,
		streaming: true,
		supportedEndpoints: supportsResponses ? [ModelSupportedEndpoint.ChatCompletions, ModelSupportedEndpoint.Responses] : undefined,
		supportsReasoningEffort: thinking ? ['low', 'medium', 'high'] : undefined
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readPositiveNumber(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return Math.round(value);
}

function readDisplayName(modelId: string, data: Record<string, unknown> | undefined): string {
	const name = data?.name ?? data?.display_name;
	return typeof name === 'string' && name.trim() ? name.trim() : modelId;
}

function includesAny(value: string, needles: readonly string[]): boolean {
	return needles.some(needle => value.includes(needle));
}

function inferContextWindow(lowerModelId: string): number {
	if (includesAny(lowerModelId, ['gemini-1.5', 'gemini-2', 'gpt-4.1'])) {
		return 1000000;
	}
	if (includesAny(lowerModelId, ['claude', 'qwen3-coder', 'deepseek', 'grok', 'llama-4'])) {
		return 200000;
	}
	if (includesAny(lowerModelId, ['gpt-4o', 'gpt-5', 'o1', 'o3', 'o4', 'llama', 'mistral', 'mixtral'])) {
		return 128000;
	}
	return 128000;
}

function inferMaxOutputTokens(lowerModelId: string): number {
	if (includesAny(lowerModelId, ['claude', 'gemini', 'reasoning', 'o1', 'o3', 'o4', 'qwen3'])) {
		return 16384;
	}
	return 8192;
}

// Type guards to ensure correct config type
export function isGlobalKeyConfig(config: BYOKModelConfig): config is BYOKGlobalKeyModelConfig {
	return 'apiKey' in config && !('deploymentUrl' in config);
}

export function isPerModelConfig(config: BYOKModelConfig): config is BYOKPerModelConfig {
	return 'apiKey' in config && 'deploymentUrl' in config;
}

export function isNoAuthConfig(config: BYOKModelConfig): config is BYOKNoAuthModelConfig {
	return !('apiKey' in config) && !('deploymentUrl' in config);
}

export function resolveModelInfo(modelId: string, providerName: string, knownModels: BYOKKnownModels | undefined, modelCapabilities?: BYOKModelCapabilities): IChatModelInformation {
	// Model Capabilities are something the user has decided on so those take precedence, then we rely on known model info, then defaults.
	let knownModelInfo = modelCapabilities;
	if (knownModels && !knownModelInfo) {
		knownModelInfo = knownModels[modelId];
	}
	const modelName = knownModelInfo?.name || modelId;
	const contextWinow = knownModelInfo ? (knownModelInfo.maxInputTokens + knownModelInfo.maxOutputTokens) : 128000;
	const modelInfo: IChatModelInformation = {
		id: modelId,
		name: modelName,
		vendor: providerName,
		version: '1.0.0',
		capabilities: {
			type: 'chat',
			family: modelId,
			supports: {
				streaming: knownModelInfo?.streaming ?? true,
				tool_calls: !!knownModelInfo?.toolCalling,
				vision: !!knownModelInfo?.vision,
				thinking: !!knownModelInfo?.thinking,
				adaptive_thinking: !!knownModelInfo?.adaptiveThinking
			},
			tokenizer: TokenizerType.O200K,
			limits: {
				max_context_window_tokens: contextWinow,
				max_prompt_tokens: knownModelInfo?.maxInputTokens || 100000,
				max_output_tokens: knownModelInfo?.maxOutputTokens || 8192
			}
		},
		is_chat_default: false,
		is_chat_fallback: false,
		model_picker_enabled: true,
		supported_endpoints: knownModelInfo?.supportedEndpoints,
		zeroDataRetentionEnabled: knownModelInfo?.zeroDataRetentionEnabled
	};
	if (knownModelInfo?.requestHeaders && Object.keys(knownModelInfo.requestHeaders).length > 0) {
		modelInfo.requestHeaders = { ...knownModelInfo.requestHeaders };
	}
	return modelInfo;
}

export function byokKnownModelsToAPIInfo(providerName: string, knownModels: BYOKKnownModels | undefined): LanguageModelChatInformation[] {
	if (!knownModels) {
		return [];
	}
	return Object.entries(knownModels).map(([id, capabilities]) => byokKnownModelToAPIInfo(providerName, id, capabilities));
}

export function byokKnownModelToAPIInfo(providerName: string, id: string, capabilities: BYOKModelCapabilities): LanguageModelChatInformation {
	return {
		id,
		name: capabilities.name,
		version: '1.0.0',
		maxOutputTokens: capabilities.maxOutputTokens,
		maxInputTokens: capabilities.maxInputTokens,
		// `detail` is intentionally omitted: when this model is resolved
		// via a configured provider group, `LanguageModelsService` will
		// fall back to the group name so multiple instances of the same
		// vendor (e.g. multiple Ollama servers) are distinguishable in
		// the model picker.
		family: id,
		tooltip: `${capabilities.name} is contributed via the ${providerName} provider.`,
		multiplierNumeric: 0,
		isUserSelectable: true,
		capabilities: {
			toolCalling: capabilities.toolCalling,
			imageInput: capabilities.vision
		},
	};
}

export function isBYOKEnabled(_copilotToken: Omit<CopilotToken, 'token'>, _capiClientService: ICAPIClientService): boolean {
	return true;
}

/**
 * Result of handling an API key update operation.
 */
export interface HandleAPIKeyUpdateResult {
	/**
	 * The new API key value, or undefined if the key was deleted or operation was cancelled.
	 */
	apiKey: string | undefined;
	/**
	 * Whether the API key was deleted (user entered empty string during reconfigure).
	 */
	deleted: boolean;
	/**
	 * Whether the operation was cancelled (user dismissed the input).
	 */
	cancelled: boolean;
}

/**
 * Storage service interface for BYOK API key operations.
 * This is a minimal interface to avoid importing the full IBYOKStorageService in common code.
 */
export interface IBYOKStorageServiceLike {
	getAPIKey(providerName: string, modelId?: string): Promise<string | undefined>;
	storeAPIKey(providerName: string, apiKey: string, authType: BYOKAuthType, modelId?: string): Promise<void>;
	deleteAPIKey(providerName: string, authType: BYOKAuthType, modelId?: string): Promise<void>;
}

/**
 * Handles API key update flow for BYOK providers using a consistent pattern.
 * This utility handles all three cases from promptForAPIKey:
 * - undefined: user cancelled/dismissed the input
 * - empty string: user wants to delete the saved key (only when reconfiguring)
 * - non-empty string: user provided a new API key
 *
 * @param providerName - Name of the provider (e.g., 'Anthropic', 'Gemini')
 * @param storageService - Storage service for API key operations
 * @param promptForAPIKeyFn - Function to prompt user for API key
 * @returns Result containing the new API key (if any) and status flags
 */
export async function handleAPIKeyUpdate(
	providerName: string,
	storageService: IBYOKStorageServiceLike,
	promptForAPIKeyFn: (providerName: string, reconfigure: boolean) => Promise<string | undefined>
): Promise<HandleAPIKeyUpdateResult> {
	const existingKey = await storageService.getAPIKey(providerName);
	const isReconfiguring = existingKey !== undefined;

	const newAPIKey = await promptForAPIKeyFn(providerName, isReconfiguring);

	if (newAPIKey === undefined) {
		// User cancelled/dismissed the input
		return { apiKey: undefined, deleted: false, cancelled: true };
	} else if (newAPIKey === '') {
		// User wants to delete the key (only valid when reconfiguring)
		await storageService.deleteAPIKey(providerName, BYOKAuthType.GlobalApiKey);
		return { apiKey: undefined, deleted: true, cancelled: false };
	} else {
		// User provided a new API key
		await storageService.storeAPIKey(providerName, newAPIKey, BYOKAuthType.GlobalApiKey);
		return { apiKey: newAPIKey, deleted: false, cancelled: false };
	}
}
