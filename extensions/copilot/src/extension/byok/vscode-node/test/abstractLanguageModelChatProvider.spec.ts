/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AbstractOpenAICompatibleLMProvider, parseAdditionalHeaders, resolveRequestTimeout, type LanguageModelChatConfiguration } from '../abstractLanguageModelChatProvider';
import type { IBYOKStorageService } from '../byokStorageService';

class TestOpenAICompatibleProvider extends AbstractOpenAICompatibleLMProvider<LanguageModelChatConfiguration> {
	public readonly fetch;

	constructor(fetchImpl: (url: string, options?: unknown) => Promise<{ ok: boolean; status?: number; statusText?: string; json: () => Promise<unknown> }>) {
		const fetch = vi.fn(fetchImpl);
		super(
			'test-provider',
			'Test Provider',
			undefined,
			createStorageService(),
			{ fetch } as any,
			createLogService(),
			{ createInstance: vi.fn(() => ({ provideLanguageModelResponse: vi.fn(), provideTokenCount: vi.fn() })) } as any,
			{} as any,
			{} as any
		);
		this.fetch = fetch;
	}

	protected override getModelsBaseUrl(configuration: LanguageModelChatConfiguration | undefined): string | undefined {
		return configuration?.baseUrl ?? configuration?.url;
	}

	public exposeDiscoveryUrl(baseUrl: string): string {
		return this.getModelsDiscoveryUrl(baseUrl);
	}

	public exposeConfiguredDiscoveryUrl(configuration: LanguageModelChatConfiguration | undefined, baseUrl: string): string {
		return this.getModelDiscoveryUrl(configuration, baseUrl);
	}

	public exposeExtractModelList(data: unknown): unknown[] | undefined {
		return this.extractModelList(data);
	}
}

function createStorageService(): IBYOKStorageService {
	return {
		getAPIKey: vi.fn().mockResolvedValue(undefined),
		storeAPIKey: vi.fn().mockResolvedValue(undefined),
		deleteAPIKey: vi.fn().mockResolvedValue(undefined),
		getStoredModelConfigs: vi.fn().mockResolvedValue({}),
		saveModelConfig: vi.fn().mockResolvedValue(undefined),
		removeModelConfig: vi.fn().mockResolvedValue(undefined),
	};
}

function createLogService() {
	const logService = {
		_serviceBrand: undefined,
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		show: vi.fn(),
		createSubLogger: vi.fn(),
		withExtraTarget: vi.fn(),
	};
	logService.createSubLogger.mockReturnValue(logService);
	logService.withExtraTarget.mockReturnValue(logService);
	return logService;
}

describe('AbstractOpenAICompatibleLMProvider', () => {
	it('validates custom request timeouts', () => {
		expect(resolveRequestTimeout(undefined, 15000)).toBe(15000);
		expect(resolveRequestTimeout(250, 15000)).toBe(250);
		expect(resolveRequestTimeout(120000, 15000)).toBe(120000);
		expect(() => resolveRequestTimeout(249, 15000)).toThrow();
		expect(() => resolveRequestTimeout(120001, 15000)).toThrow();
		expect(() => resolveRequestTimeout(1.5, 15000)).toThrow();
	});

	it('parses additional headers without exposing values in configuration JSON', () => {
		expect(parseAdditionalHeaders('X-Organization: example; X-Project: pointer')).toEqual({
			'X-Organization': 'example',
			'X-Project': 'pointer'
		});
		expect(() => parseAdditionalHeaders('invalid-header')).toThrow();
		expect(() => parseAdditionalHeaders('X-Test: value\r\ninjected: value')).toThrow();
	});

	it('does not fetch disabled providers', async () => {
		const provider = new TestOpenAICompatibleProvider(async () => {
			throw new Error('disabled providers must not fetch');
		});
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const models = await provider.provideLanguageModelChatInformation({
				silent: false,
				configuration: {
					baseUrl: 'https://example.com/v1',
					enabled: false
				}
			}, tokenSource.token);

			expect(models).toEqual([]);
			expect(provider.fetch).not.toHaveBeenCalled();
		} finally {
			tokenSource.dispose();
		}
	});

	it('uses configured timeout and additional headers for model discovery', async () => {
		const provider = new TestOpenAICompatibleProvider(async () => ({
			ok: true,
			json: async () => ({ data: [{ id: 'test-model' }] })
		}));
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			await provider.provideLanguageModelChatInformation({
				silent: false,
				configuration: {
					baseUrl: 'https://example.com/v1',
					authType: 'none',
					requestTimeout: 2500,
					additionalHeaders: 'X-Organization: example'
				}
			}, tokenSource.token);

			expect(provider.fetch).toHaveBeenCalledWith('https://example.com/v1/models', expect.objectContaining({
				timeout: 2500,
				headers: expect.objectContaining({ 'X-Organization': 'example' })
			}));
		} finally {
			tokenSource.dispose();
		}
	});

	it('does not fetch for an unconfigured provider during silent discovery', async () => {
		const provider = new TestOpenAICompatibleProvider(async () => {
			throw new Error('silent discovery must not fetch');
		});
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const models = await provider.provideLanguageModelChatInformation({ silent: true }, tokenSource.token);

			expect(models).toEqual([]);
			expect(provider.fetch).not.toHaveBeenCalled();
		} finally {
			tokenSource.dispose();
		}
	});

	it('normalizes discovery endpoints and respects explicit model URLs', () => {
		const provider = new TestOpenAICompatibleProvider(async () => ({
			ok: true,
			json: async () => ({ data: [] }),
		}));

		expect(provider.exposeDiscoveryUrl('https://example.com/v1')).toBe('https://example.com/v1/models');
		expect(provider.exposeDiscoveryUrl('https://example.com/v1/chat/completions')).toBe('https://example.com/v1/models');
		expect(provider.exposeDiscoveryUrl('https://example.com/api/v1/models')).toBe('https://example.com/api/v1/models');
		expect(provider.exposeConfiguredDiscoveryUrl({ modelsFetchUrl: ' https://example.com/custom-models/ ' }, 'https://example.com/v1')).toBe('https://example.com/custom-models');
	});

	it('parses root arrays, items arrays, and nested model arrays from discovery responses', () => {
		const provider = new TestOpenAICompatibleProvider(async () => ({
			ok: true,
			json: async () => ({ data: [] }),
		}));

		expect(provider.exposeExtractModelList([{ id: 'one' }])).toEqual([{ id: 'one' }]);
		expect(provider.exposeExtractModelList({ items: [{ name: 'two' }] })).toEqual([{ name: 'two' }]);
		expect(provider.exposeExtractModelList({ data: { models: [{ id: 'three' }] } })).toEqual([{ id: 'three' }]);
	});

	it('accepts name-only models and falls back to cached/manual models on discovery failure', async () => {
		const tokenSource = new vscode.CancellationTokenSource();

		const nameOnlyProvider = new TestOpenAICompatibleProvider(async () => ({
			ok: true,
			json: async () => ({ items: [{ name: 'name-only-model' }] }),
		}));

		const discovered = await nameOnlyProvider.provideLanguageModelChatInformation({
			silent: false,
			configuration: {
				baseUrl: 'https://example.com/v1',
				authType: 'none'
			}
		}, tokenSource.token);

		expect(discovered.map(model => model.id)).toEqual(['name-only-model']);

		const cachedFallbackProvider = new TestOpenAICompatibleProvider(async () => {
			throw new Error('boom');
		});

		const fallbackModels = await cachedFallbackProvider.provideLanguageModelChatInformation({
			silent: false,
			configuration: {
				baseUrl: 'https://example.com/v1',
				authType: 'none',
				cachedModels: [{ id: 'cached-model', name: 'Cached Model' }],
				manualModels: ['manual-model'],
				defaultChatModel: 'cached-model',
				defaultCodingModel: 'manual-model'
			}
		}, tokenSource.token);

		expect(fallbackModels.map(model => model.id)).toEqual(['cached-model', 'manual-model']);
		const chatDefaults = fallbackModels[0].isDefault;
		const codingDefaults = fallbackModels[1].isDefault;
		expect(typeof chatDefaults === 'object' && chatDefaults[vscode.ChatLocation.Panel]).toBe(true);
		expect(typeof codingDefaults === 'object' && codingDefaults[vscode.ChatLocation.Editor]).toBe(true);
		expect(fallbackModels[1].capabilities?.toolCalling).toBe(false);
		expect(fallbackModels[1].capabilities?.imageInput).toBe(false);
	});

	it('keeps unique cached and manual models after successful discovery', async () => {
		const provider = new TestOpenAICompatibleProvider(async () => ({
			ok: true,
			json: async () => ({ data: [{ id: 'discovered-model' }] }),
		}));
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const models = await provider.provideLanguageModelChatInformation({
				silent: false,
				configuration: {
					baseUrl: 'https://example.com/v1',
					authType: 'none',
					cachedModels: [{
						id: 'cached-model',
						name: 'Cached Model',
						maxInputTokens: 32000,
						maxOutputTokens: 2048,
						toolCalling: true,
						vision: true
					}],
					manualModels: ['manual-model']
				}
			}, tokenSource.token);

			expect(models.map(model => model.id)).toEqual(['discovered-model', 'cached-model', 'manual-model']);
			expect(models.find(model => model.id === 'cached-model')).toMatchObject({
				name: 'Cached Model',
				maxInputTokens: 32000,
				maxOutputTokens: 2048,
				capabilities: { toolCalling: true, imageInput: true }
			});
		} finally {
			tokenSource.dispose();
		}
	});

	it('prefers discovered metadata when a cached model has the same id', async () => {
		const provider = new TestOpenAICompatibleProvider(async () => ({
			ok: true,
			json: async () => ({
				data: [{
					id: 'duplicate-model',
					name: 'Discovered Model',
					max_input_tokens: 64000,
					max_output_tokens: 4096,
					supported_parameters: ['tools'],
					input_modalities: ['text', 'image']
				}]
			}),
		}));
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const models = await provider.provideLanguageModelChatInformation({
				silent: false,
				configuration: {
					baseUrl: 'https://example.com/v1',
					authType: 'none',
					cachedModels: [{
						id: 'duplicate-model',
						name: 'Cached Model',
						maxInputTokens: 1000,
						maxOutputTokens: 100,
						toolCalling: false,
						vision: false
					}]
				}
			}, tokenSource.token);

			expect(models).toHaveLength(1);
			expect(models[0]).toMatchObject({
				id: 'duplicate-model',
				name: 'Discovered Model',
				maxInputTokens: 64000,
				maxOutputTokens: 4096,
				capabilities: { toolCalling: true, imageInput: true }
			});
		} finally {
			tokenSource.dispose();
		}
	});

	it('keeps default roles and fallback capabilities for merged manual models', async () => {
		const provider = new TestOpenAICompatibleProvider(async () => ({
			ok: true,
			json: async () => ({ data: [{ id: 'discovered-model' }] }),
		}));
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const models = await provider.provideLanguageModelChatInformation({
				silent: false,
				configuration: {
					baseUrl: 'https://example.com/v1',
					authType: 'none',
					manualModels: ['manual-model'],
					defaultChatModel: 'discovered-model',
					defaultCodingModel: 'manual-model'
				}
			}, tokenSource.token);

			const discoveredModel = models.find(model => model.id === 'discovered-model');
			const manualModel = models.find(model => model.id === 'manual-model');
			expect(typeof discoveredModel?.isDefault === 'object' && discoveredModel.isDefault[vscode.ChatLocation.Panel]).toBe(true);
			expect(typeof manualModel?.isDefault === 'object' && manualModel.isDefault[vscode.ChatLocation.Editor]).toBe(true);
			expect(manualModel).toMatchObject({
				maxInputTokens: 128000,
				maxOutputTokens: 8192,
				capabilities: { toolCalling: false, imageInput: false }
			});
		} finally {
			tokenSource.dispose();
		}
	});
});
