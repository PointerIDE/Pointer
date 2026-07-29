/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AsyncIterableSource, DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ChatMessageRole, LanguageModelsService, IChatMessage, IChatResponsePart, ILanguageModelChatMetadata, LanguageModelsProviderConnectionErrorCode } from '../../common/languageModels.js';
import { IExtensionService, nullExtensionDescription } from '../../../../services/extensions/common/extensions.js';
import { DEFAULT_MODEL_PICKER_CATEGORY } from '../../common/widget/input/modelPickerWidget.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';
import { ILanguageModelsConfigurationService, ILanguageModelsProviderGroup } from '../../common/languageModelsConfiguration.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { TestSecretStorageService } from '../../../../../platform/secrets/test/common/testSecretStorageService.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { ChatAgentLocation } from '../../common/constants.js';

suite('LanguageModels', function () {

	let languageModels: LanguageModelsService;

	const store = new DisposableStore();
	const activationEvents = new Set<string>();

	class TestLanguageModelsConfigurationService extends mock<ILanguageModelsConfigurationService>() {
		private readonly _onDidChangeLanguageModelGroups = new Emitter<readonly ILanguageModelsProviderGroup[]>();
		override readonly onDidChangeLanguageModelGroups = this._onDidChangeLanguageModelGroups.event;
		groups: ILanguageModelsProviderGroup[];
		failAdd = false;
		failUpdate = false;
		emitChanges = false;

		constructor(groups: ILanguageModelsProviderGroup[] = []) {
			super();
			this.groups = groups;
		}

		override getLanguageModelsProviderGroups(): readonly ILanguageModelsProviderGroup[] {
			return this.groups;
		}

		override async addLanguageModelsProviderGroup(group: ILanguageModelsProviderGroup): Promise<ILanguageModelsProviderGroup> {
			if (this.failAdd) {
				throw new Error('Simulated provider group add failure');
			}
			this.groups = [...this.groups, group];
			return group;
		}

		override async updateLanguageModelsProviderGroup(from: ILanguageModelsProviderGroup, to: ILanguageModelsProviderGroup): Promise<ILanguageModelsProviderGroup> {
			if (this.failUpdate) {
				throw new Error('Simulated provider group update failure');
			}
			this.groups = this.groups.map(group => group === from || (group.name === from.name && group.vendor === from.vendor) ? to : group);
			if (this.emitChanges) {
				this._onDidChangeLanguageModelGroups.fire([to]);
			}
			return to;
		}

		override async removeLanguageModelsProviderGroup(toRemove: ILanguageModelsProviderGroup): Promise<void> {
			this.groups = this.groups.filter(group => group !== toRemove && (group.name !== toRemove.name || group.vendor !== toRemove.vendor));
		}

		override async configureLanguageModels(): Promise<void> { }

		dispose(): void {
			this._onDidChangeLanguageModelGroups.dispose();
		}
	}

	function createSecretProviderService(initialGroups: ILanguageModelsProviderGroup[] = [], registerProvider = false) {
		languageModels.dispose();
		const secretStorage = new TestSecretStorageService();
		const configurationService = new TestLanguageModelsConfigurationService(initialGroups);
		const storageService = new TestStorageService();
		const service = new LanguageModelsService(
			new class extends mock<IExtensionService>() { override activateByEvent() { return Promise.resolve(); } },
			new NullLogService(),
			storageService,
			new MockContextKeyService(),
			configurationService,
			new class extends mock<IQuickInputService>() { },
			secretStorage,
			new class extends mock<IProductService>() { override readonly version = '1.100.0'; },
			new class extends mock<IRequestService>() { },
		);

		service.deltaLanguageModelChatProviderDescriptors([{
			vendor: 'secret-vendor',
			displayName: 'Secret Vendor',
			configuration: {
				type: 'object',
				properties: {
					apiKey: { type: 'string', secret: true },
					additionalHeaders: { type: 'string', secret: true },
					baseUrl: { type: 'string' }
				}
			// TypeFromJsonSchema cannot represent this nested draft-07 schema in the test descriptor.
			} as unknown as undefined,
			managementCommand: undefined,
			when: undefined
		}], []);

		const providerRegistration = registerProvider
			? service.registerLanguageModelProvider('secret-vendor', {
				onDidChange: Event.None,
				provideLanguageModelChatInfo: async () => [],
				sendChatRequest: async () => { throw new Error(); },
				provideTokenCount: async () => { throw new Error(); }
			})
			: undefined;

		return {
			configurationService,
			secretStorage,
			service,
				dispose: () => {
				providerRegistration?.dispose();
				service.dispose();
				configurationService.dispose();
				storageService.dispose();
				secretStorage.dispose();
			}
		};
	}

	function getStoredSecretKey(group: ILanguageModelsProviderGroup, property = 'apiKey'): string {
		const reference = group[property];
		assert.strictEqual(typeof reference, 'string');
		const match = /^\$\{input:(.+)\}$/.exec(reference as string);
		assert.ok(match);
		return match[1];
	}

	setup(function () {

		languageModels = new LanguageModelsService(
			new class extends mock<IExtensionService>() {
				override activateByEvent(name: string) {
					activationEvents.add(name);
					return Promise.resolve();
				}
			},
			new NullLogService(),
			new TestStorageService(),
			new MockContextKeyService(),
			new class extends mock<ILanguageModelsConfigurationService>() {
				override onDidChangeLanguageModelGroups = Event.None;
				override getLanguageModelsProviderGroups() {
					return [];
				}
			},
			new class extends mock<IQuickInputService>() { },
			new TestSecretStorageService(),
			new class extends mock<IProductService>() { override readonly version = '1.100.0'; },
			new class extends mock<IRequestService>() { },
		);

		languageModels.deltaLanguageModelChatProviderDescriptors([
			{ vendor: 'test-vendor', displayName: 'Test Vendor', configuration: undefined, managementCommand: undefined, when: undefined },
			{ vendor: 'actual-vendor', displayName: 'Actual Vendor', configuration: undefined, managementCommand: undefined, when: undefined }
		], []);

		store.add(languageModels.registerLanguageModelProvider('test-vendor', {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async () => {
				const modelMetadata = [
					{
						extension: nullExtensionDescription.identifier,
						name: 'Pretty Name',
						vendor: 'test-vendor',
						family: 'test-family',
						version: 'test-version',
						modelPickerCategory: undefined,
						id: 'test-id-1',
						maxInputTokens: 100,
						maxOutputTokens: 100,
						isDefaultForLocation: {}
					} satisfies ILanguageModelChatMetadata,
					{
						extension: nullExtensionDescription.identifier,
						name: 'Pretty Name',
						vendor: 'test-vendor',
						family: 'test2-family',
						version: 'test2-version',
						modelPickerCategory: undefined,
						id: 'test-id-12',
						maxInputTokens: 100,
						maxOutputTokens: 100,
						isDefaultForLocation: {}
					} satisfies ILanguageModelChatMetadata
				];
				const modelMetadataAndIdentifier = modelMetadata.map(m => ({
					metadata: m,
					identifier: m.id,
				}));
				return modelMetadataAndIdentifier;
			},
			sendChatRequest: async () => {
				throw new Error();
			},
			provideTokenCount: async () => {
				throw new Error();
			}
		}));
	});

	teardown(function () {
		languageModels.dispose();
		activationEvents.clear();
		store.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('empty selector returns all', async function () {

		const result1 = await languageModels.selectLanguageModels({});
		assert.deepStrictEqual(result1.length, 2);
		assert.deepStrictEqual(result1[0], 'test-id-1');
		assert.deepStrictEqual(result1[1], 'test-id-12');
	});

	test('selector with id works properly', async function () {
		const result1 = await languageModels.selectLanguageModels({ id: 'test-id-1' });
		assert.deepStrictEqual(result1.length, 1);
		assert.deepStrictEqual(result1[0], 'test-id-1');
	});

	test('no warning that a matching model was not found #213716', async function () {
		const result1 = await languageModels.selectLanguageModels({ vendor: 'test-vendor' });
		assert.deepStrictEqual(result1.length, 2);

		const result2 = await languageModels.selectLanguageModels({ vendor: 'test-vendor', family: 'FAKE' });
		assert.deepStrictEqual(result2.length, 0);
	});

	test('classifies provider connection failures with stable error codes', async function () {
		const cases: readonly { detail: string; errorCode: LanguageModelsProviderConnectionErrorCode }[] = [
			{ detail: 'connect ECONNREFUSED 127.0.0.1:11434', errorCode: 'unreachable' },
			{ detail: 'HTTP 401 Unauthorized', errorCode: 'authenticationFailed' },
			{ detail: 'Model pointer-test-model was not found', errorCode: 'modelNotFound' },
			{ detail: 'The provider returned an empty model list', errorCode: 'noModels' },
			{ detail: 'Invalid response format from the OpenAI-compatible endpoint', errorCode: 'incompatibleProtocol' },
			{ detail: 'Request timed out', errorCode: 'timeout' },
			{ detail: 'self-signed certificate in certificate chain', errorCode: 'tls' },
			{ detail: 'Tool calling capability is unsupported', errorCode: 'capabilityUnsupported' },
			{ detail: 'HTTP 503 Service Unavailable', errorCode: 'providerUnavailable' },
			{ detail: 'Unexpected provider failure', errorCode: 'unknown' }
		];

		for (const [index, testCase] of cases.entries()) {
			const vendor = `connection-test-${index}`;
			languageModels.deltaLanguageModelChatProviderDescriptors([
				{ vendor, displayName: vendor, configuration: undefined, managementCommand: undefined, when: undefined }
			], []);
			store.add(languageModels.registerLanguageModelProvider(vendor, {
				onDidChange: Event.None,
				provideLanguageModelChatInfo: async () => { throw new Error(testCase.detail); },
				sendChatRequest: async () => { throw new Error(); },
				provideTokenCount: async () => { throw new Error(); }
			}));

			const result = await languageModels.testProviderConnection(vendor, {});
			assert.strictEqual(result.success, false);
			assert.strictEqual(result.errorCode, testCase.errorCode, testCase.detail);
		}
	});

	test('reports a successful connection with zero discovered models as noModels', async function () {
		const vendor = 'connection-test-no-models';
		languageModels.deltaLanguageModelChatProviderDescriptors([
			{ vendor, displayName: vendor, configuration: undefined, managementCommand: undefined, when: undefined }
		], []);
		store.add(languageModels.registerLanguageModelProvider(vendor, {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async () => [],
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		}));

		const result = await languageModels.testProviderConnection(vendor, {});
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.errorCode, 'noModels');
		assert.deepStrictEqual(result.models, []);
		assert.strictEqual(result.error, undefined);
	});

	test('preserves exact provider model metadata and the legacy token total', async function () {
		const vendor = 'connection-test-model-metadata';
		languageModels.deltaLanguageModelChatProviderDescriptors([
			{ vendor, displayName: vendor, configuration: undefined, managementCommand: undefined, when: undefined }
		], []);
		store.add(languageModels.registerLanguageModelProvider(vendor, {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async () => [{
				identifier: `${vendor}/plain-model`,
				metadata: {
					extension: nullExtensionDescription.identifier,
					name: 'Provider Metadata Model',
					vendor,
					family: 'plain-model',
					version: '1.0.0',
					modelPickerCategory: undefined,
					id: 'plain-model',
					maxInputTokens: 32768,
					maxOutputTokens: 4096,
					isDefaultForLocation: {},
					capabilities: {
						vision: false,
						toolCalling: true,
						agentMode: false,
						editTools: ['apply_patch']
					}
				} satisfies ILanguageModelChatMetadata
			}],
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		}));

		const result = await languageModels.testProviderConnection(vendor, {});

		assert.strictEqual(result.success, true);
		assert.deepStrictEqual(result.models, [{
			id: 'plain-model',
			name: 'Provider Metadata Model',
			maxInputTokens: 32768,
			maxOutputTokens: 4096,
			capabilities: {
				vision: false,
				toolCalling: true,
				agentMode: false,
				editTools: ['apply_patch']
			},
			tokens: 36864
		}]);
	});

	test('redacts configured API keys and additional header values from connection diagnostics', async function () {
		const { service, dispose } = createSecretProviderService();
		const providerRegistration = service.registerLanguageModelProvider('secret-vendor', {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async options => {
				throw new Error(`HTTP 401 rejected ${options.configuration?.apiKey}; headers ${options.configuration?.additionalHeaders}; token header-secret-456`);
			},
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		});

		const result = await service.testProviderConnection('secret-vendor', {
			apiKey: 'api-secret-123',
			additionalHeaders: 'X-Organization: header-secret-456'
		});

		assert.strictEqual(result.errorCode, 'authenticationFailed');
		assert.ok(result.error?.includes('[redacted]'));
		assert.ok(!result.error?.includes('api-secret-123'));
		assert.ok(!result.error?.includes('X-Organization: header-secret-456'));
		assert.ok(!result.error?.includes('header-secret-456'));

		providerRegistration.dispose();
		dispose();
	});

	test('stores secret provider configuration in secret storage when adding a group', async function () {
		const { configurationService, secretStorage, service, dispose } = createSecretProviderService();

		await service.addLanguageModelsProviderGroup('Secret Vendor', 'secret-vendor', {
			baseUrl: 'https://example.com/v1',
			apiKey: 'secret-123',
			additionalHeaders: 'X-Organization: secret-header-value'
		});

		assert.strictEqual(configurationService.groups.length, 1);
		assert.strictEqual(configurationService.groups[0].baseUrl, 'https://example.com/v1');
		const secretKey = getStoredSecretKey(configurationService.groups[0]);
		assert.strictEqual(await secretStorage.get(secretKey), 'secret-123');
		const headersSecretKey = getStoredSecretKey(configurationService.groups[0], 'additionalHeaders');
		assert.strictEqual(await secretStorage.get(headersSecretKey), 'X-Organization: secret-header-value');

		dispose();
	});

	test('preserves the stored secret on blank and masked provider group updates', async function () {
		const { configurationService, secretStorage, service, dispose } = createSecretProviderService();

		await service.addLanguageModelsProviderGroup('Secret Vendor', 'secret-vendor', {
			baseUrl: 'https://example.com/v1',
			apiKey: 'secret-123'
		});
		let existing = configurationService.groups[0];
		const reference = existing.apiKey;
		const secretKey = getStoredSecretKey(existing);

		await service.updateLanguageModelsProviderGroup(existing, 'Secret Vendor', 'secret-vendor', {
			baseUrl: 'https://example.com/v2',
			apiKey: ''
		});

		assert.strictEqual(configurationService.groups[0].apiKey, reference);
		assert.strictEqual(await secretStorage.get(secretKey), 'secret-123');

		existing = configurationService.groups[0];
		await service.updateLanguageModelsProviderGroup(existing, 'Secret Vendor', 'secret-vendor', {
			baseUrl: 'https://example.com/v3',
			apiKey: reference
		});

		assert.strictEqual(configurationService.groups[0].apiKey, reference);
		assert.strictEqual(await secretStorage.get(secretKey), 'secret-123');

		dispose();
	});

	test('removes only the explicitly cleared stored secret on provider group update', async function () {
		const { configurationService, secretStorage, service, dispose } = createSecretProviderService();

		await service.addLanguageModelsProviderGroup('Secret Vendor', 'secret-vendor', {
			baseUrl: 'https://example.com/v1',
			apiKey: 'secret-123',
			additionalHeaders: 'X-Organization: secret-header-value'
		});
		const existing = configurationService.groups[0];
		const apiKeySecretKey = getStoredSecretKey(existing);
		const headersReference = existing.additionalHeaders;
		const headersSecretKey = getStoredSecretKey(existing, 'additionalHeaders');

		await service.updateLanguageModelsProviderGroup(existing, 'Secret Vendor', 'secret-vendor', {
			baseUrl: 'https://example.com/v2',
			apiKey: null,
			additionalHeaders: headersReference
		});

		assert.strictEqual(configurationService.groups[0].apiKey, undefined);
		assert.strictEqual(configurationService.groups[0].additionalHeaders, headersReference);
		assert.strictEqual(await secretStorage.get(apiKeySecretKey), undefined);
		assert.strictEqual(await secretStorage.get(headersSecretKey), 'X-Organization: secret-header-value');

		dispose();
	});

	test('clones secret references into group-owned secret storage entries when adding a group', async function () {
		const { configurationService, secretStorage, service, dispose } = createSecretProviderService();

		await service.addLanguageModelsProviderGroup('Original', 'secret-vendor', {
			baseUrl: 'https://example.com/v1',
			apiKey: 'secret-123',
			additionalHeaders: 'X-Organization: secret-header-value'
		});
		const original = configurationService.groups[0];
		const originalApiKeyReference = original.apiKey;
		const originalHeadersReference = original.additionalHeaders;
		const originalApiKeySecretKey = getStoredSecretKey(original);
		const originalHeadersSecretKey = getStoredSecretKey(original, 'additionalHeaders');

		await service.addLanguageModelsProviderGroup('Copy', 'secret-vendor', {
			baseUrl: original.baseUrl,
			apiKey: originalApiKeyReference,
			additionalHeaders: originalHeadersReference
		});
		const copy = configurationService.groups[1];
		const copyApiKeySecretKey = getStoredSecretKey(copy);
		const copyHeadersSecretKey = getStoredSecretKey(copy, 'additionalHeaders');

		assert.notStrictEqual(copy.apiKey, originalApiKeyReference);
		assert.notStrictEqual(copy.additionalHeaders, originalHeadersReference);
		assert.notStrictEqual(copyApiKeySecretKey, originalApiKeySecretKey);
		assert.notStrictEqual(copyHeadersSecretKey, originalHeadersSecretKey);
		assert.strictEqual(await secretStorage.get(copyApiKeySecretKey), 'secret-123');
		assert.strictEqual(await secretStorage.get(copyHeadersSecretKey), 'X-Organization: secret-header-value');

		await service.updateLanguageModelsProviderGroup(copy, 'Copy', 'secret-vendor', {
			baseUrl: 'https://example.com/v2',
			apiKey: 'copy-secret-456',
			additionalHeaders: copy.additionalHeaders
		});
		assert.strictEqual(await secretStorage.get(originalApiKeySecretKey), 'secret-123');

		await service.removeLanguageModelsProviderGroup('secret-vendor', 'Copy');
		assert.strictEqual(configurationService.groups.length, 1);
		assert.strictEqual(await secretStorage.get(originalApiKeySecretKey), 'secret-123');
		assert.strictEqual(await secretStorage.get(originalHeadersSecretKey), 'X-Organization: secret-header-value');

		dispose();
	});

	test('cleans up cloned secret entries when adding a provider group fails', async function () {
		const { configurationService, secretStorage, service, dispose } = createSecretProviderService();

		await service.addLanguageModelsProviderGroup('Original', 'secret-vendor', {
			apiKey: 'secret-123',
			additionalHeaders: 'X-Organization: secret-header-value'
		});
		const original = configurationService.groups[0];
		const originalSecretKeys = (await secretStorage.keys()).sort();
		configurationService.failAdd = true;

		await assert.rejects(() => service.addLanguageModelsProviderGroup('Copy', 'secret-vendor', {
			apiKey: original.apiKey,
			additionalHeaders: original.additionalHeaders
		}), /Simulated provider group add failure/);

		assert.strictEqual(configurationService.groups.length, 1);
		assert.deepStrictEqual((await secretStorage.keys()).sort(), originalSecretKeys);

		dispose();
	});

	test('replaces a stored secret through a newly committed reference', async function () {
		const { configurationService, secretStorage, service, dispose } = createSecretProviderService();

		await service.addLanguageModelsProviderGroup('Secret Vendor', 'secret-vendor', {
			baseUrl: 'https://example.com/v1',
			apiKey: 'secret-123'
		});
		const existing = configurationService.groups[0];
		const reference = existing.apiKey;
		const secretKey = getStoredSecretKey(existing);

		await service.updateLanguageModelsProviderGroup(existing, 'Secret Vendor', 'secret-vendor', {
			baseUrl: 'https://example.com/v2',
			apiKey: 'secret-456'
		});

		const replacementSecretKey = getStoredSecretKey(configurationService.groups[0]);
		assert.notStrictEqual(configurationService.groups[0].apiKey, reference);
		assert.notStrictEqual(replacementSecretKey, secretKey);
		assert.strictEqual(await secretStorage.get(secretKey), undefined);
		assert.strictEqual(await secretStorage.get(replacementSecretKey), 'secret-456');

		dispose();
	});

	test('rolls back staged provider secrets when updating the configuration fails', async function () {
		const { configurationService, secretStorage, service, dispose } = createSecretProviderService();

		await service.addLanguageModelsProviderGroup('Secret Vendor', 'secret-vendor', {
			baseUrl: 'https://example.com/v1',
			apiKey: 'secret-123'
		});
		const existing = configurationService.groups[0];
		const originalReference = existing.apiKey;
		const originalSecretKey = getStoredSecretKey(existing);
		const originalSecretKeys = (await secretStorage.keys()).sort();
		configurationService.failUpdate = true;

		await assert.rejects(() => service.updateLanguageModelsProviderGroup(existing, 'Secret Vendor', 'secret-vendor', {
			baseUrl: 'https://example.com/v2',
			apiKey: 'secret-456'
		}), /Simulated provider group update failure/);

		assert.strictEqual(configurationService.groups[0], existing);
		assert.strictEqual(configurationService.groups[0].apiKey, originalReference);
		assert.strictEqual(await secretStorage.get(originalSecretKey), 'secret-123');
		assert.deepStrictEqual((await secretStorage.keys()).sort(), originalSecretKeys);

		dispose();
	});

	test('resolves a provider once from the configuration change after updating a group', async function () {
		const existing: ILanguageModelsProviderGroup = {
			name: 'Secret Vendor',
			vendor: 'secret-vendor',
			baseUrl: 'https://example.com/v1'
		};
		const { configurationService, service, dispose } = createSecretProviderService([existing]);
		const requests: { group: string | undefined; silent: boolean }[] = [];
		const resolutionFinished = new DeferredPromise<void>();
		const providerRegistration = service.registerLanguageModelProvider('secret-vendor', {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async options => {
				requests.push({ group: options.group, silent: options.silent });
				if (requests.length === 2) {
					await resolutionFinished.complete(undefined);
				}
				return [];
			},
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		});
		configurationService.emitChanges = true;

		await service.updateLanguageModelsProviderGroup(existing, 'Secret Vendor', 'secret-vendor', {
			baseUrl: 'https://example.com/v2'
		});
		await resolutionFinished.p;
		await timeout(0);

		assert.deepStrictEqual(requests, [
			{ group: undefined, silent: true },
			{ group: 'Secret Vendor', silent: true }
		]);

		providerRegistration.dispose();
		dispose();
	});

	test('rejects a colliding provider rename before mutating configuration or secrets', async function () {
		const { configurationService, secretStorage, service, dispose } = createSecretProviderService();

		await service.addLanguageModelsProviderGroup('Provider A', 'secret-vendor', {
			baseUrl: 'https://a.example/v1',
			apiKey: 'secret-a'
		});
		await service.addLanguageModelsProviderGroup('Provider B', 'secret-vendor', {
			baseUrl: 'https://b.example/v1',
			apiKey: 'secret-b'
		});

		const providerA = configurationService.groups[0];
		const providerASecretKey = getStoredSecretKey(providerA);
		const providerBSecretKey = getStoredSecretKey(configurationService.groups[1]);
		const originalGroups = configurationService.groups.map(group => ({ ...group }));
		const originalSecretKeys = (await secretStorage.keys()).sort();

		await assert.rejects(() => service.updateLanguageModelsProviderGroup(providerA, 'Provider B', 'secret-vendor', {
			baseUrl: 'https://replacement.example/v1',
			apiKey: 'replacement-secret'
		}), /already exists/);

		assert.deepStrictEqual(configurationService.groups, originalGroups);
		assert.deepStrictEqual((await secretStorage.keys()).sort(), originalSecretKeys);
		assert.strictEqual(await secretStorage.get(providerASecretKey), 'secret-a');
		assert.strictEqual(await secretStorage.get(providerBSecretKey), 'secret-b');

		dispose();
	});

	test('migrates plaintext secrets on provider group update', async function () {
		const existing: ILanguageModelsProviderGroup = {
			name: 'Secret Vendor',
			vendor: 'secret-vendor',
			baseUrl: 'https://example.com/v1',
			apiKey: 'secret-123'
		};
		const { configurationService, secretStorage, service, dispose } = createSecretProviderService([existing]);

		await service.updateLanguageModelsProviderGroup(existing, 'Secret Vendor', 'secret-vendor', {
			baseUrl: 'https://example.com/v2'
		});

		const secretKey = getStoredSecretKey(configurationService.groups[0]);
		assert.strictEqual(await secretStorage.get(secretKey), 'secret-123');
		assert.notStrictEqual(configurationService.groups[0].apiKey, 'secret-123');

		dispose();
	});

	test('migrates plaintext secrets when loading a provider group', async function () {
		const existing: ILanguageModelsProviderGroup = {
			name: 'Secret Vendor',
			vendor: 'secret-vendor',
			baseUrl: 'https://example.com/v1',
			apiKey: 'secret-123'
		};
		const { configurationService, secretStorage, service, dispose } = createSecretProviderService([existing], true);

		await service.selectLanguageModels({ vendor: 'secret-vendor' });

		const secretKey = getStoredSecretKey(configurationService.groups[0]);
		assert.strictEqual(await secretStorage.get(secretKey), 'secret-123');
		assert.notStrictEqual(configurationService.groups[0].apiKey, 'secret-123');

		dispose();
	});

	test('removes stored secrets with the provider group', async function () {
		const { configurationService, secretStorage, service, dispose } = createSecretProviderService();

		await service.addLanguageModelsProviderGroup('Secret Vendor', 'secret-vendor', {
			baseUrl: 'https://example.com/v1',
			apiKey: 'secret-123'
		});
		const secretKey = getStoredSecretKey(configurationService.groups[0]);

		await service.removeLanguageModelsProviderGroup('secret-vendor', 'Secret Vendor');

		assert.strictEqual(configurationService.groups.length, 0);
		assert.strictEqual(await secretStorage.get(secretKey), undefined);

		dispose();
	});

	test('sendChatRequest returns a response-stream', async function () {

		store.add(languageModels.registerLanguageModelProvider('actual-vendor', {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async () => {
				const modelMetadata = [
					{
						extension: nullExtensionDescription.identifier,
						name: 'Pretty Name',
						vendor: 'actual-vendor',
						family: 'actual-family',
						version: 'actual-version',
						id: 'actual-lm',
						maxInputTokens: 100,
						maxOutputTokens: 100,
						modelPickerCategory: DEFAULT_MODEL_PICKER_CATEGORY,
						isDefaultForLocation: {}
					} satisfies ILanguageModelChatMetadata
				];
				const modelMetadataAndIdentifier = modelMetadata.map(m => ({
					metadata: m,
					identifier: m.id,
				}));
				return modelMetadataAndIdentifier;
			},
			sendChatRequest: async (modelId: string, messages: IChatMessage[], _from: ExtensionIdentifier | undefined, _options: { [name: string]: any }, token: CancellationToken) => {
				// const message = messages.at(-1);

				const defer = new DeferredPromise();
				const stream = new AsyncIterableSource<IChatResponsePart>();

				(async () => {
					while (!token.isCancellationRequested) {
						stream.emitOne({ type: 'text', value: Date.now().toString() });
						await timeout(10);
					}
					defer.complete(undefined);
				})();

				return {
					stream: stream.asyncIterable,
					result: defer.p
				};
			},
			provideTokenCount: async () => {
				throw new Error();
			}
		}));

		// Register the extension point for the actual vendor
		languageModels.deltaLanguageModelChatProviderDescriptors([
			{ vendor: 'actual-vendor', displayName: 'Actual Vendor', configuration: undefined, managementCommand: undefined, when: undefined }
		], []);

		const models = await languageModels.selectLanguageModels({ id: 'actual-lm' });
		assert.ok(models.length === 1);

		const first = models[0];

		const cts = new CancellationTokenSource();

		const request = await languageModels.sendChatRequest(first, nullExtensionDescription.identifier, [{ role: ChatMessageRole.User, content: [{ type: 'text', value: 'hello' }] }], {}, cts.token);

		assert.ok(request);

		cts.dispose(true);

		await request.result;
	});

	test('when clause defaults to true when omitted', async function () {
		const vendors = languageModels.getVendors();
		// Both test-vendor and actual-vendor have no when clause, so they should be visible
		assert.ok(vendors.length >= 2);
		assert.ok(vendors.some(v => v.vendor === 'test-vendor'));
		assert.ok(vendors.some(v => v.vendor === 'actual-vendor'));
	});
});

suite('LanguageModels - When Clause', function () {

	class TestContextKeyService extends MockContextKeyService {
		override contextMatchesRules(rules: ContextKeyExpression): boolean {
			if (!rules) {
				return true;
			}
			// Simple evaluation based on stored keys
			const keys = rules.keys();
			for (const key of keys) {
				const contextKey = this.getContextKeyValue(key);
				// If the key exists and is truthy, the rule matches
				if (contextKey) {
					return true;
				}
			}
			return false;
		}
	}

	let languageModelsWithWhen: LanguageModelsService;
	let contextKeyService: TestContextKeyService;

	setup(function () {
		contextKeyService = new TestContextKeyService();
		contextKeyService.createKey('testKey', true);

		languageModelsWithWhen = new LanguageModelsService(
			new class extends mock<IExtensionService>() {
				override activateByEvent(name: string) {
					return Promise.resolve();
				}
			},
			new NullLogService(),
			new TestStorageService(),
			contextKeyService,
			new class extends mock<ILanguageModelsConfigurationService>() {
				override onDidChangeLanguageModelGroups = Event.None;
			},
			new class extends mock<IQuickInputService>() { },
			new TestSecretStorageService(),
			new class extends mock<IProductService>() { override readonly version = '1.100.0'; },
			new class extends mock<IRequestService>() { },
		);

		languageModelsWithWhen.deltaLanguageModelChatProviderDescriptors([
			{ vendor: 'visible-vendor', displayName: 'Visible Vendor', configuration: undefined, managementCommand: undefined, when: undefined },
			{ vendor: 'conditional-vendor', displayName: 'Conditional Vendor', configuration: undefined, managementCommand: undefined, when: 'testKey' },
			{ vendor: 'hidden-vendor', displayName: 'Hidden Vendor', configuration: undefined, managementCommand: undefined, when: 'falseKey' }
		], []);
	});

	teardown(function () {
		languageModelsWithWhen.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('when clause filters vendors correctly', async function () {
		const vendors = languageModelsWithWhen.getVendors();
		assert.strictEqual(vendors.length, 2);
		assert.ok(vendors.some(v => v.vendor === 'visible-vendor'));
		assert.ok(vendors.some(v => v.vendor === 'conditional-vendor'));
		assert.ok(!vendors.some(v => v.vendor === 'hidden-vendor'));
	});

	test('when clause evaluates to true when context key is true', async function () {
		const vendors = languageModelsWithWhen.getVendors();
		assert.ok(vendors.some(v => v.vendor === 'conditional-vendor'), 'conditional-vendor should be visible when testKey is true');
	});

	test('when clause evaluates to false when context key is false', async function () {
		const vendors = languageModelsWithWhen.getVendors();
		assert.ok(!vendors.some(v => v.vendor === 'hidden-vendor'), 'hidden-vendor should be hidden when falseKey is false');
	});

});

suite('LanguageModels - Model Picker Preferences Storage', function () {

	let languageModelsService: LanguageModelsService;
	let storageService: TestStorageService;
	const disposables = new DisposableStore();

	setup(async function () {
		storageService = new TestStorageService();

		languageModelsService = new LanguageModelsService(
			new class extends mock<IExtensionService>() {
				override activateByEvent(name: string) {
					return Promise.resolve();
				}
			},
			new NullLogService(),
			storageService,
			new MockContextKeyService(),
			new class extends mock<ILanguageModelsConfigurationService>() {
				override onDidChangeLanguageModelGroups = Event.None;
				override getLanguageModelsProviderGroups() {
					return [];
				}
			},
			new class extends mock<IQuickInputService>() { },
			new TestSecretStorageService(),
			new class extends mock<IProductService>() { override readonly version = '1.100.0'; },
			new class extends mock<IRequestService>() { },
		);

		// Register vendor1 used in most tests
		languageModelsService.deltaLanguageModelChatProviderDescriptors([
			{ vendor: 'vendor1', displayName: 'Vendor 1', configuration: undefined, managementCommand: undefined, when: undefined }
		], []);

		disposables.add(languageModelsService.registerLanguageModelProvider('vendor1', {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async () => {
				return [{
					metadata: {
						extension: nullExtensionDescription.identifier,
						name: 'Model 1',
						vendor: 'vendor1',
						family: 'family1',
						version: '1.0',
						id: 'vendor1/model1',
						maxInputTokens: 100,
						maxOutputTokens: 100,
						modelPickerCategory: DEFAULT_MODEL_PICKER_CATEGORY,
						isDefaultForLocation: {}
					} satisfies ILanguageModelChatMetadata,
					identifier: 'vendor1/model1'
				}];
			},
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		}));

		// Populate the model cache
		await languageModelsService.selectLanguageModels({});
	});

	teardown(function () {
		languageModelsService.dispose();
		disposables.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('fires onChange event when new model preferences are added', async function () {
		// Listen for change event
		let firedVendorId: string | undefined;
		disposables.add(languageModelsService.onDidChangeLanguageModels(vendorId => firedVendorId = vendorId));

		// Add new preferences to storage - store() automatically triggers change event synchronously
		const preferences = {
			'vendor1/model1': true
		};
		storageService.store('chatModelPickerPreferences', JSON.stringify(preferences), StorageScope.PROFILE, StorageTarget.USER);

		// Verify change event was fired
		assert.strictEqual(firedVendorId, 'vendor1', 'Should fire change event for vendor1');

		// Verify preference was updated
		const model = languageModelsService.lookupLanguageModel('vendor1/model1');
		assert.ok(model);
		assert.strictEqual(model.isUserSelectable, true);
	});

	test('fires onChange event when model preferences are removed', async function () {
		// Set initial preference using the API
		languageModelsService.updateModelPickerPreference('vendor1/model1', true);

		// Listen for change event
		let firedVendorId: string | undefined;
		disposables.add(languageModelsService.onDidChangeLanguageModels(vendorId => {
			firedVendorId = vendorId;
		}));

		// Remove preferences via storage API
		const updatedPreferences = {};
		storageService.store('chatModelPickerPreferences', JSON.stringify(updatedPreferences), StorageScope.PROFILE, StorageTarget.USER);

		// Verify change event was fired
		assert.strictEqual(firedVendorId, 'vendor1', 'Should fire change event for vendor1 when preference removed');

		// Verify preference was removed
		const model = languageModelsService.lookupLanguageModel('vendor1/model1');
		assert.ok(model);
		assert.strictEqual(model.isUserSelectable, undefined);
	});

	test('fires onChange event when model preferences are updated', async function () {
		// Set initial preference using the API
		languageModelsService.updateModelPickerPreference('vendor1/model1', true);

		// Listen for change event
		let firedVendorId: string | undefined;
		disposables.add(languageModelsService.onDidChangeLanguageModels(vendorId => {
			firedVendorId = vendorId;
		}));

		// Update the preference value
		const updatedPreferences = {
			'vendor1/model1': false
		};
		storageService.store('chatModelPickerPreferences', JSON.stringify(updatedPreferences), StorageScope.PROFILE, StorageTarget.USER);

		// Verify change event was fired
		assert.strictEqual(firedVendorId, 'vendor1', 'Should fire change event for vendor1 when preference updated');

		// Verify preference was updated
		const model = languageModelsService.lookupLanguageModel('vendor1/model1');
		assert.ok(model);
		assert.strictEqual(model.isUserSelectable, false);
	});

	test('only fires onChange event for affected vendors', async function () {
		// Register vendor2
		languageModelsService.deltaLanguageModelChatProviderDescriptors([
			{ vendor: 'vendor2', displayName: 'Vendor 2', configuration: undefined, managementCommand: undefined, when: undefined }
		], []);

		disposables.add(languageModelsService.registerLanguageModelProvider('vendor2', {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async () => {
				return [{
					metadata: {
						extension: nullExtensionDescription.identifier,
						name: 'Model 2',
						vendor: 'vendor2',
						family: 'family2',
						version: '1.0',
						id: 'vendor2/model2',
						maxInputTokens: 100,
						maxOutputTokens: 100,
						modelPickerCategory: DEFAULT_MODEL_PICKER_CATEGORY,
						isDefaultForLocation: {}
					} satisfies ILanguageModelChatMetadata,
					identifier: 'vendor2/model2'
				}];
			},
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		}));

		await languageModelsService.selectLanguageModels({});

		// Set initial preferences using the API
		languageModelsService.updateModelPickerPreference('vendor1/model1', true);
		languageModelsService.updateModelPickerPreference('vendor2/model2', false);

		// Listen for change event
		let firedVendorId: string | undefined;
		disposables.add(languageModelsService.onDidChangeLanguageModels(vendorId => {
			firedVendorId = vendorId;
		}));

		// Update only vendor1 preference
		const updatedPreferences = {
			'vendor1/model1': false,
			'vendor2/model2': false // unchanged
		};
		storageService.store('chatModelPickerPreferences', JSON.stringify(updatedPreferences), StorageScope.PROFILE, StorageTarget.USER);

		// Verify only vendor1 was affected
		assert.strictEqual(firedVendorId, 'vendor1', 'Should only affect vendor1');

		// Verify preferences were updated correctly
		const model1 = languageModelsService.lookupLanguageModel('vendor1/model1');
		assert.ok(model1);
		assert.strictEqual(model1.isUserSelectable, false, 'vendor1/model1 should be updated to false');

		const model2 = languageModelsService.lookupLanguageModel('vendor2/model2');
		assert.ok(model2);
		assert.strictEqual(model2.isUserSelectable, false, 'vendor2/model2 should remain false');
	});

	test('does not fire onChange event when preferences are unchanged', async function () {
		// Set initial preference using the API
		languageModelsService.updateModelPickerPreference('vendor1/model1', true);

		// Listen for change event
		let eventFired = false;
		disposables.add(languageModelsService.onDidChangeLanguageModels(() => {
			eventFired = true;
		}));

		// Store the same preferences again
		const initialPreferences = {
			'vendor1/model1': true
		};
		storageService.store('chatModelPickerPreferences', JSON.stringify(initialPreferences), StorageScope.PROFILE, StorageTarget.USER);

		// Verify no event was fired
		assert.strictEqual(eventFired, false, 'Should not fire event when preferences are unchanged');

		// Verify preference remains the same
		const model = languageModelsService.lookupLanguageModel('vendor1/model1');
		assert.ok(model);
		assert.strictEqual(model.isUserSelectable, true);
	});

	test('handles malformed JSON in storage gracefully', function () {
		// Listen for change event
		let eventFired = false;
		disposables.add(languageModelsService.onDidChangeLanguageModels(() => {
			eventFired = true;
		}));

		// Store empty preferences - store() automatically triggers change event
		storageService.store('chatModelPickerPreferences', '{}', StorageScope.PROFILE, StorageTarget.USER);

		// Verify no event was fired - empty preferences is valid and causes no changes
		assert.strictEqual(eventFired, false, 'Should not fire event for empty preferences');
	});
});

suite('LanguageModels - Model Change Events', function () {

	let languageModelsService: LanguageModelsService;
	let storageService: TestStorageService;
	const disposables = new DisposableStore();

	setup(async function () {
		storageService = new TestStorageService();

		languageModelsService = new LanguageModelsService(
			new class extends mock<IExtensionService>() {
				override activateByEvent(name: string) {
					return Promise.resolve();
				}
			},
			new NullLogService(),
			storageService,
			new MockContextKeyService(),
			new class extends mock<ILanguageModelsConfigurationService>() {
				override onDidChangeLanguageModelGroups = Event.None;
				override getLanguageModelsProviderGroups() {
					return [];
				}
			},
			new class extends mock<IQuickInputService>() { },
			new TestSecretStorageService(),
			new class extends mock<IProductService>() { override readonly version = '1.100.0'; },
			new class extends mock<IRequestService>() { },
		);

		// Register the vendor first
		languageModelsService.deltaLanguageModelChatProviderDescriptors([
			{ vendor: 'test-vendor', displayName: 'Test Vendor', configuration: undefined, managementCommand: undefined, when: undefined }
		], []);
	});

	teardown(function () {
		languageModelsService.dispose();
		disposables.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('fires onChange event when new models are added', async function () {
		// Create a promise that resolves when the event fires
		const eventPromise = new Promise<string>((resolve) => {
			disposables.add(languageModelsService.onDidChangeLanguageModels((vendorId) => {
				resolve(vendorId);
			}));
		});

		// Store a preference to trigger auto-resolution when provider is registered
		storageService.store('chatModelPickerPreferences', JSON.stringify({ 'test-vendor/model1': true }), StorageScope.PROFILE, StorageTarget.USER);

		disposables.add(languageModelsService.registerLanguageModelProvider('test-vendor', {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async () => {
				return [{
					metadata: {
						extension: nullExtensionDescription.identifier,
						name: 'Model 1',
						vendor: 'test-vendor',
						family: 'family1',
						version: '1.0',
						id: 'model1',
						maxInputTokens: 100,
						maxOutputTokens: 100,
						modelPickerCategory: undefined,
						isDefaultForLocation: {}
					} satisfies ILanguageModelChatMetadata,
					identifier: 'test-vendor/model1'
				}];
			},
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		}));

		const firedVendorId = await eventPromise;
		assert.strictEqual(firedVendorId, 'test-vendor', 'Should fire event when new models are added');
	});

	test('does not fire onChange event when models are unchanged', async function () {
		const models = [{
			metadata: {
				extension: nullExtensionDescription.identifier,
				name: 'Model 1',
				vendor: 'test-vendor',
				family: 'family1',
				version: '1.0',
				id: 'model1',
				maxInputTokens: 100,
				maxOutputTokens: 100,
				modelPickerCategory: undefined,
				isDefaultForLocation: {}
			} satisfies ILanguageModelChatMetadata,
			identifier: 'test-vendor/model1'
		}];

		let onDidChangeEmitter: any;
		disposables.add(languageModelsService.registerLanguageModelProvider('test-vendor', {
			onDidChange: (listener) => {
				onDidChangeEmitter = { fire: () => listener() };
				return { dispose: () => { } };
			},
			provideLanguageModelChatInfo: async () => models,
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		}));

		// Initial resolution
		await languageModelsService.selectLanguageModels({ vendor: 'test-vendor' });

		// Listen for change event
		let eventFired = false;
		disposables.add(languageModelsService.onDidChangeLanguageModels(() => {
			eventFired = true;
		}));
		// Trigger provider change with same models
		onDidChangeEmitter.fire();

		// Call selectLanguageModels again - provider will return different models
		await languageModelsService.selectLanguageModels({ vendor: 'test-vendor' });
		assert.strictEqual(eventFired, false, 'Should not fire event when models are unchanged');
	});

	test('fires onChange event when model metadata changes', async function () {
		const initialModels = [{
			metadata: {
				extension: nullExtensionDescription.identifier,
				name: 'Model 1',
				vendor: 'test-vendor',
				family: 'family1',
				version: '1.0',
				id: 'model1',
				maxInputTokens: 100,
				maxOutputTokens: 100,
				modelPickerCategory: undefined,
				isDefaultForLocation: {}
			} satisfies ILanguageModelChatMetadata,
			identifier: 'test-vendor/model1'
		}];

		let currentModels = initialModels;
		let onDidChangeEmitter: any;
		disposables.add(languageModelsService.registerLanguageModelProvider('test-vendor', {
			onDidChange: (listener) => {
				onDidChangeEmitter = { fire: () => listener() };
				return { dispose: () => { } };
			},
			provideLanguageModelChatInfo: async () => currentModels,
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		}));

		// Initial resolution
		await languageModelsService.selectLanguageModels({ vendor: 'test-vendor' });

		// Create a promise that resolves when the event fires
		const eventPromise = new Promise<void>((resolve) => {
			disposables.add(languageModelsService.onDidChangeLanguageModels(() => {
				resolve();
			}));
		});

		// Change model metadata (e.g., maxInputTokens)
		currentModels = [{
			metadata: {
				...initialModels[0].metadata,
				maxInputTokens: 200 // Changed from 100
			},
			identifier: 'test-vendor/model1'
		}];

		onDidChangeEmitter.fire();

		await eventPromise;
		assert.ok(true, 'Event fired when model metadata changed');
	});

	test('fires onChange event when models are removed', async function () {
		let currentModels = [{
			metadata: {
				extension: nullExtensionDescription.identifier,
				name: 'Model 1',
				vendor: 'test-vendor',
				family: 'family1',
				version: '1.0',
				id: 'model1',
				maxInputTokens: 100,
				maxOutputTokens: 100,
				modelPickerCategory: undefined,
				isDefaultForLocation: {}
			} satisfies ILanguageModelChatMetadata,
			identifier: 'test-vendor/model1'
		}];

		let onDidChangeEmitter: any;
		disposables.add(languageModelsService.registerLanguageModelProvider('test-vendor', {
			onDidChange: (listener) => {
				onDidChangeEmitter = { fire: () => listener() };
				return { dispose: () => { } };
			},
			provideLanguageModelChatInfo: async () => currentModels,
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		}));

		// Initial resolution
		await languageModelsService.selectLanguageModels({ vendor: 'test-vendor' });

		// Create a promise that resolves when the event fires
		const eventPromise = new Promise<void>((resolve) => {
			disposables.add(languageModelsService.onDidChangeLanguageModels(() => {
				resolve();
			}));
		});

		// Remove all models
		currentModels = [];

		onDidChangeEmitter.fire();

		await eventPromise;
		assert.ok(true, 'Event fired when models were removed');
	});

	test('fires onChange event when new model is added to existing set', async function () {
		let currentModels = [{
			metadata: {
				extension: nullExtensionDescription.identifier,
				name: 'Model 1',
				vendor: 'test-vendor',
				family: 'family1',
				version: '1.0',
				id: 'model1',
				maxInputTokens: 100,
				maxOutputTokens: 100,
				modelPickerCategory: undefined,
				isDefaultForLocation: {}
			} satisfies ILanguageModelChatMetadata,
			identifier: 'test-vendor/model1'
		}];

		let onDidChangeEmitter: any;
		disposables.add(languageModelsService.registerLanguageModelProvider('test-vendor', {
			onDidChange: (listener) => {
				onDidChangeEmitter = { fire: () => listener() };
				return { dispose: () => { } };
			},
			provideLanguageModelChatInfo: async () => currentModels,
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		}));

		// Initial resolution
		await languageModelsService.selectLanguageModels({ vendor: 'test-vendor' });

		// Create a promise that resolves when the event fires
		const eventPromise = new Promise<void>((resolve) => {
			disposables.add(languageModelsService.onDidChangeLanguageModels(() => {
				resolve();
			}));
		});

		// Add a new model
		currentModels = [
			...currentModels,
			{
				metadata: {
					extension: nullExtensionDescription.identifier,
					name: 'Model 2',
					vendor: 'test-vendor',
					family: 'family2',
					version: '1.0',
					id: 'model2',
					maxInputTokens: 100,
					maxOutputTokens: 100,
					modelPickerCategory: undefined,
					isDefaultForLocation: {}
				} satisfies ILanguageModelChatMetadata,
				identifier: 'test-vendor/model2'
			}
		];

		onDidChangeEmitter.fire();

		await eventPromise;
		assert.ok(true, 'Event fired when new model was added');
	});

	test('fires onChange event when models change without provider emitting change event', async function () {
		let callCount = 0;
		disposables.add(languageModelsService.registerLanguageModelProvider('test-vendor', {
			onDidChange: Event.None, // Provider doesn't emit change events
			provideLanguageModelChatInfo: async () => {
				callCount++;
				if (callCount === 1) {
					// First call returns initial model
					return [{
						metadata: {
							extension: nullExtensionDescription.identifier,
							name: 'Model 1',
							vendor: 'test-vendor',
							family: 'family1',
							version: '1.0',
							id: 'model1',
							maxInputTokens: 100,
							maxOutputTokens: 100,
							modelPickerCategory: undefined,
							isDefaultForLocation: {}
						} satisfies ILanguageModelChatMetadata,
						identifier: 'test-vendor/model1'
					}];
				} else {
					// Subsequent calls return different model
					return [{
						metadata: {
							extension: nullExtensionDescription.identifier,
							name: 'Model 2',
							vendor: 'test-vendor',
							family: 'family2',
							version: '2.0',
							id: 'model2',
							maxInputTokens: 200,
							maxOutputTokens: 200,
							modelPickerCategory: undefined,
							isDefaultForLocation: {}
						} satisfies ILanguageModelChatMetadata,
						identifier: 'test-vendor/model2'
					}];
				}
			},
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		}));

		// Initial resolution
		await languageModelsService.selectLanguageModels({ vendor: 'test-vendor' });

		// Listen for change event
		let eventFired = false;
		disposables.add(languageModelsService.onDidChangeLanguageModels(() => {
			eventFired = true;
		}));

		// Call selectLanguageModels again - provider will return different models
		await languageModelsService.selectLanguageModels({ vendor: 'test-vendor' });

		assert.strictEqual(eventFired, true, 'Should fire event when models change even without provider change event');
	});
});

suite('LanguageModels - Vendor Change Events', function () {

	let languageModelsService: LanguageModelsService;
	const disposables = new DisposableStore();

	setup(function () {
		languageModelsService = new LanguageModelsService(
			new class extends mock<IExtensionService>() {
				override activateByEvent(name: string) {
					return Promise.resolve();
				}
			},
			new NullLogService(),
			new TestStorageService(),
			new MockContextKeyService(),
			new class extends mock<ILanguageModelsConfigurationService>() {
				override onDidChangeLanguageModelGroups = Event.None;
				override getLanguageModelsProviderGroups() {
					return [];
				}
			},
			new class extends mock<IQuickInputService>() { },
			new TestSecretStorageService(),
			new class extends mock<IProductService>() { override readonly version = '1.100.0'; },
			new class extends mock<IRequestService>() { },
		);
	});

	teardown(function () {
		languageModelsService.dispose();
		disposables.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('fires onDidChangeLanguageModelVendors when a vendor is added', async function () {
		const eventPromise = new Promise<readonly string[]>((resolve) => {
			disposables.add(languageModelsService.onDidChangeLanguageModelVendors(vendors => resolve(vendors)));
		});

		languageModelsService.deltaLanguageModelChatProviderDescriptors([
			{ vendor: 'added-vendor', displayName: 'Added Vendor', configuration: undefined, managementCommand: undefined, when: undefined }
		], []);

		const vendors = await eventPromise;
		assert.ok(vendors.includes('added-vendor'));
	});

	test('fires onDidChangeLanguageModelVendors when a vendor is removed', async function () {
		languageModelsService.deltaLanguageModelChatProviderDescriptors([
			{ vendor: 'removed-vendor', displayName: 'Removed Vendor', configuration: undefined, managementCommand: undefined, when: undefined }
		], []);

		const eventPromise = new Promise<readonly string[]>((resolve) => {
			disposables.add(languageModelsService.onDidChangeLanguageModelVendors(vendors => resolve(vendors)));
		});

		languageModelsService.deltaLanguageModelChatProviderDescriptors([], [
			{ vendor: 'removed-vendor', displayName: 'Removed Vendor', configuration: undefined, managementCommand: undefined, when: undefined }
		]);

		const vendors = await eventPromise;
		assert.ok(vendors.includes('removed-vendor'));
	});

	test('fires onDidChangeLanguageModelVendors when multiple vendors are added and removed', async function () {
		// Add multiple vendors
		const addEventPromise = new Promise<readonly string[]>((resolve) => {
			disposables.add(languageModelsService.onDidChangeLanguageModelVendors(vendors => resolve(vendors)));
		});

		languageModelsService.deltaLanguageModelChatProviderDescriptors([
			{ vendor: 'vendor-a', displayName: 'Vendor A', configuration: undefined, managementCommand: undefined, when: undefined },
			{ vendor: 'vendor-b', displayName: 'Vendor B', configuration: undefined, managementCommand: undefined, when: undefined }
		], []);

		const addedVendors = await addEventPromise;
		assert.ok(addedVendors.includes('vendor-a'));
		assert.ok(addedVendors.includes('vendor-b'));

		// Remove one vendor
		const removeEventPromise = new Promise<readonly string[]>((resolve) => {
			disposables.add(languageModelsService.onDidChangeLanguageModelVendors(vendors => resolve(vendors)));
		});

		languageModelsService.deltaLanguageModelChatProviderDescriptors([], [
			{ vendor: 'vendor-a', displayName: 'Vendor A', configuration: undefined, managementCommand: undefined, when: undefined }
		]);

		const removedVendors = await removeEventPromise;
		assert.ok(removedVendors.includes('vendor-a'));
	});

	test('does not fire onDidChangeLanguageModelVendors when no vendors are added or removed', async function () {
		// Add initial vendor
		languageModelsService.deltaLanguageModelChatProviderDescriptors([
			{ vendor: 'stable-vendor', displayName: 'Stable Vendor', configuration: undefined, managementCommand: undefined, when: undefined }
		], []);

		// Listen for change event
		let eventFired = false;
		disposables.add(languageModelsService.onDidChangeLanguageModelVendors(() => {
			eventFired = true;
		}));

		// Call with empty arrays - should not fire event
		languageModelsService.deltaLanguageModelChatProviderDescriptors([], []);

		assert.strictEqual(eventFired, false, 'Should not fire event when vendor list is unchanged');
	});
});

suite('LanguageModels - Per-Model Configuration', function () {

	let languageModelsService: LanguageModelsService;
	const disposables = new DisposableStore();
	let receivedOptions: { [name: string]: unknown } | undefined;

	setup(async function () {
		receivedOptions = undefined;

		languageModelsService = new LanguageModelsService(
			new class extends mock<IExtensionService>() {
				override activateByEvent() {
					return Promise.resolve();
				}
			},
			new NullLogService(),
			new TestStorageService(),
			new MockContextKeyService(),
			new class extends mock<ILanguageModelsConfigurationService>() {
				override onDidChangeLanguageModelGroups = Event.None;
				override getLanguageModelsProviderGroups() {
					return [{
						vendor: 'config-vendor',
						name: 'default',
						settings: {
							'model-a': { temperature: 0.7, reasoningEffort: 'high' },
							'model-b': { temperature: 0.2 }
						}
					}];
				}
			},
			new class extends mock<IQuickInputService>() { },
			new TestSecretStorageService(),
			new class extends mock<IProductService>() { override readonly version = '1.100.0'; },
			new class extends mock<IRequestService>() { },
		);

		languageModelsService.deltaLanguageModelChatProviderDescriptors([
			{ vendor: 'config-vendor', displayName: 'Config Vendor', configuration: undefined, managementCommand: undefined, when: undefined }
		], []);

		disposables.add(languageModelsService.registerLanguageModelProvider('config-vendor', {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async (options) => {
				if (options.group) {
					return [{
						metadata: {
							extension: nullExtensionDescription.identifier,
							name: 'Model A',
							vendor: 'config-vendor',
							family: 'family-a',
							version: '1.0',
							id: 'model-a',
							maxInputTokens: 100,
							maxOutputTokens: 100,
							modelPickerCategory: DEFAULT_MODEL_PICKER_CATEGORY,
							isDefaultForLocation: {},
							configurationSchema: {
								type: 'object',
								properties: {
									temperature: { type: 'number', default: 0.5 },
									reasoningEffort: { type: 'string', default: 'medium' },
									maxTokens: { type: 'number', default: 4096 }
								}
							}
						} satisfies ILanguageModelChatMetadata,
						identifier: 'config-vendor/default/model-a'
					}, {
						metadata: {
							extension: nullExtensionDescription.identifier,
							name: 'Model B',
							vendor: 'config-vendor',
							family: 'family-b',
							version: '1.0',
							id: 'model-b',
							maxInputTokens: 100,
							maxOutputTokens: 100,
							modelPickerCategory: DEFAULT_MODEL_PICKER_CATEGORY,
							isDefaultForLocation: {}
						} satisfies ILanguageModelChatMetadata,
						identifier: 'config-vendor/default/model-b'
					}];
				}
				return [];
			},
			sendChatRequest: async (_modelId, _messages, _from, options) => {
				receivedOptions = options;
				const defer = new DeferredPromise();
				const stream = new AsyncIterableSource<IChatResponsePart>();
				stream.resolve();
				defer.complete(undefined);
				return { stream: stream.asyncIterable, result: defer.p };
			},
			provideTokenCount: async () => { throw new Error(); }
		}));

		await languageModelsService.selectLanguageModels({});
	});

	teardown(function () {
		languageModelsService.dispose();
		disposables.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('getModelConfiguration returns per-model config from group', function () {
		const configA = languageModelsService.getModelConfiguration('config-vendor/default/model-a');
		assert.deepStrictEqual(configA, { temperature: 0.7, reasoningEffort: 'high', maxTokens: 4096 });

		const configB = languageModelsService.getModelConfiguration('config-vendor/default/model-b');
		assert.deepStrictEqual(configB, { temperature: 0.2 });
	});

	test('getModelConfiguration returns undefined for unknown model', function () {
		const config = languageModelsService.getModelConfiguration('config-vendor/default/model-c');
		assert.strictEqual(config, undefined);
	});

	test('sendChatRequest merges schema defaults with user config', async function () {
		const cts = disposables.add(new CancellationTokenSource());
		const request = await languageModelsService.sendChatRequest(
			'config-vendor/default/model-a',
			nullExtensionDescription.identifier,
			[{ role: ChatMessageRole.User, content: [{ type: 'text', value: 'hello' }] }],
			{},
			cts.token
		);
		await request.result;

		// User config overrides defaults: temperature=0.7 (not 0.5), reasoningEffort='high' (not 'medium')
		// Schema default maxTokens=4096 is included since user didn't override it
		assert.deepStrictEqual(receivedOptions, { configuration: { temperature: 0.7, reasoningEffort: 'high', maxTokens: 4096 } });
	});

	test('sendChatRequest passes user config when model has no schema', async function () {
		const cts = disposables.add(new CancellationTokenSource());
		const request = await languageModelsService.sendChatRequest(
			'config-vendor/default/model-b',
			nullExtensionDescription.identifier,
			[{ role: ChatMessageRole.User, content: [{ type: 'text', value: 'hello' }] }],
			{},
			cts.token
		);
		await request.result;

		assert.deepStrictEqual(receivedOptions, { configuration: { temperature: 0.2 } });
	});
});

suite('LanguageModels - Provider Group Detail Fallback', function () {

	const disposables = new DisposableStore();

	teardown(function () {
		disposables.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('model.detail falls back to the group name so multiple instances of the same vendor are distinguishable', async function () {
		const languageModelsService = disposables.add(new LanguageModelsService(
			new class extends mock<IExtensionService>() {
				override activateByEvent() {
					return Promise.resolve();
				}
			},
			new NullLogService(),
			disposables.add(new TestStorageService()),
			new MockContextKeyService(),
			new class extends mock<ILanguageModelsConfigurationService>() {
				override onDidChangeLanguageModelGroups = Event.None;
				override getLanguageModelsProviderGroups() {
					return [
						{ vendor: 'multi-vendor', name: 'Local' },
						{ vendor: 'multi-vendor', name: 'Remote' }
					];
				}
			},
			new class extends mock<IQuickInputService>() { },
			new TestSecretStorageService(),
			new class extends mock<IProductService>() { override readonly version = '1.100.0'; },
			new class extends mock<IRequestService>() { },
		));

		languageModelsService.deltaLanguageModelChatProviderDescriptors([
			// Cast needed: TypeFromJsonSchema resolves the `anyOf`+`$ref` configuration
			// field to `undefined`, but the runtime value must be truthy so the
			// service treats this vendor as a configurable (BYOK) provider and
			// resolves models for every group rather than stopping after the first.
			{ vendor: 'multi-vendor', displayName: 'Multi Vendor', configuration: {} as unknown as undefined, managementCommand: undefined, when: undefined }
		], []);

		disposables.add(languageModelsService.registerLanguageModelProvider('multi-vendor', {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async (options) => {
				if (!options.group) {
					return [];
				}
				// Provider returns the same model id for each group, but the
				// identifier is namespaced by group so they don't collide.
				// The provider does not set `detail`; the service should fall
				// back to the per-instance group name.
				return [{
					metadata: {
						extension: nullExtensionDescription.identifier,
						name: 'Shared Model',
						vendor: 'multi-vendor',
						family: 'shared',
						version: '1.0',
						id: 'shared-model',
						maxInputTokens: 100,
						maxOutputTokens: 100,
						modelPickerCategory: DEFAULT_MODEL_PICKER_CATEGORY,
						isDefaultForLocation: {}
					} satisfies ILanguageModelChatMetadata,
					identifier: `multi-vendor/${options.group}/shared-model`
				}];
			},
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		}));

		await languageModelsService.selectLanguageModels({});

		const local = languageModelsService.lookupLanguageModel('multi-vendor/Local/shared-model');
		const remote = languageModelsService.lookupLanguageModel('multi-vendor/Remote/shared-model');

		assert.deepStrictEqual(
			{ localDetail: local?.detail, remoteDetail: remote?.detail },
			{ localDetail: 'Local', remoteDetail: 'Remote' }
		);
	});

	test('model.detail falls back to the group name even when there is only a single group for the vendor', async function () {
		const languageModelsService = disposables.add(new LanguageModelsService(
			new class extends mock<IExtensionService>() {
				override activateByEvent() {
					return Promise.resolve();
				}
			},
			new NullLogService(),
			disposables.add(new TestStorageService()),
			new MockContextKeyService(),
			new class extends mock<ILanguageModelsConfigurationService>() {
				override onDidChangeLanguageModelGroups = Event.None;
				override getLanguageModelsProviderGroups() {
					return [
						{ vendor: 'single-vendor', name: 'Only Instance' }
					];
				}
			},
			new class extends mock<IQuickInputService>() { },
			new TestSecretStorageService(),
			new class extends mock<IProductService>() { override readonly version = '1.100.0'; },
			new class extends mock<IRequestService>() { },
		));

		languageModelsService.deltaLanguageModelChatProviderDescriptors([
			{ vendor: 'single-vendor', displayName: 'Single Vendor', configuration: undefined, managementCommand: undefined, when: undefined }
		], []);

		disposables.add(languageModelsService.registerLanguageModelProvider('single-vendor', {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async (options) => {
				if (!options.group) {
					return [];
				}
				return [{
					metadata: {
						extension: nullExtensionDescription.identifier,
						name: 'Solo Model',
						vendor: 'single-vendor',
						family: 'solo',
						version: '1.0',
						id: 'solo-model',
						maxInputTokens: 100,
						maxOutputTokens: 100,
						modelPickerCategory: DEFAULT_MODEL_PICKER_CATEGORY,
						isDefaultForLocation: {}
					} satisfies ILanguageModelChatMetadata,
					identifier: `single-vendor/${options.group}/solo-model`
				}];
			},
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		}));

		await languageModelsService.selectLanguageModels({});

		const solo = languageModelsService.lookupLanguageModel('single-vendor/Only Instance/solo-model');

		assert.strictEqual(solo?.detail, 'Only Instance');
	});

	test('a provider-supplied detail is preserved when multiple groups exist', async function () {
		const languageModelsService = disposables.add(new LanguageModelsService(
			new class extends mock<IExtensionService>() {
				override activateByEvent() {
					return Promise.resolve();
				}
			},
			new NullLogService(),
			disposables.add(new TestStorageService()),
			new MockContextKeyService(),
			new class extends mock<ILanguageModelsConfigurationService>() {
				override onDidChangeLanguageModelGroups = Event.None;
				override getLanguageModelsProviderGroups() {
					return [
						{ vendor: 'detail-vendor', name: 'Local' },
						{ vendor: 'detail-vendor', name: 'Remote' }
					];
				}
			},
			new class extends mock<IQuickInputService>() { },
			new TestSecretStorageService(),
			new class extends mock<IProductService>() { override readonly version = '1.100.0'; },
			new class extends mock<IRequestService>() { },
		));

		languageModelsService.deltaLanguageModelChatProviderDescriptors([
			// Cast needed: see equivalent comment in the multi-vendor test above.
			{ vendor: 'detail-vendor', displayName: 'Detail Vendor', configuration: {} as unknown as undefined, managementCommand: undefined, when: undefined }
		], []);

		disposables.add(languageModelsService.registerLanguageModelProvider('detail-vendor', {
			onDidChange: Event.None,
			provideLanguageModelChatInfo: async (options) => {
				if (!options.group) {
					return [];
				}
				// Provider supplies its own detail. The service should leave
				// it untouched and only fall back to the group name when the
				// provider does not set one.
				return [{
					metadata: {
						extension: nullExtensionDescription.identifier,
						name: 'Detailed Model',
						vendor: 'detail-vendor',
						family: 'detailed',
						version: '1.0',
						id: 'detailed-model',
						detail: `Detailed (${options.group})`,
						maxInputTokens: 100,
						maxOutputTokens: 100,
						modelPickerCategory: DEFAULT_MODEL_PICKER_CATEGORY,
						isDefaultForLocation: {}
					} satisfies ILanguageModelChatMetadata,
					identifier: `detail-vendor/${options.group}/detailed-model`
				}];
			},
			sendChatRequest: async () => { throw new Error(); },
			provideTokenCount: async () => { throw new Error(); }
		}));

		await languageModelsService.selectLanguageModels({});

		const local = languageModelsService.lookupLanguageModel('detail-vendor/Local/detailed-model');
		const remote = languageModelsService.lookupLanguageModel('detail-vendor/Remote/detailed-model');

		assert.deepStrictEqual(
			{ localDetail: local?.detail, remoteDetail: remote?.detail },
			{ localDetail: 'Detailed (Local)', remoteDetail: 'Detailed (Remote)' }
		);
	});

	test('explicit default profile selects only that provider group for Chat and Edit defaults', async function () {
		const configurationService = new class extends mock<ILanguageModelsConfigurationService>() {
			override onDidChangeLanguageModelGroups = Event.None;
			override getLanguageModelsProviderGroups() {
				return [
					{ vendor: 'profile-vendor-a', name: 'Profile A', defaultChatModel: 'shared-model', defaultCodingModel: 'shared-model' },
					{ vendor: 'profile-vendor-b', name: 'Profile B', defaultChatModel: 'shared-model', defaultCodingModel: 'shared-model', isDefaultProfile: true }
				];
			}
		};
		const service = disposables.add(new LanguageModelsService(
			new class extends mock<IExtensionService>() {
				override activateByEvent() {
					return Promise.resolve();
				}
			},
			new NullLogService(),
			disposables.add(new TestStorageService()),
			new MockContextKeyService(),
			configurationService,
			new class extends mock<IQuickInputService>() { },
			new TestSecretStorageService(),
			new class extends mock<IProductService>() { override readonly version = '1.100.0'; },
			new class extends mock<IRequestService>() { },
		));

		service.deltaLanguageModelChatProviderDescriptors([
			{ vendor: 'profile-vendor-a', displayName: 'Profile Vendor A', configuration: {} as unknown as undefined, managementCommand: undefined, when: undefined },
			{ vendor: 'profile-vendor-b', displayName: 'Profile Vendor B', configuration: {} as unknown as undefined, managementCommand: undefined, when: undefined }
		], []);

		for (const vendor of ['profile-vendor-a', 'profile-vendor-b']) {
			disposables.add(service.registerLanguageModelProvider(vendor, {
				onDidChange: Event.None,
				provideLanguageModelChatInfo: async (options) => {
					if (!options.group) {
						return [];
					}
					return [{
						metadata: {
							extension: nullExtensionDescription.identifier,
							name: 'Shared Model',
							vendor,
							family: 'shared',
							version: '1.0',
							id: 'shared-model',
							maxInputTokens: 100,
							maxOutputTokens: 100,
							modelPickerCategory: DEFAULT_MODEL_PICKER_CATEGORY,
							isDefaultForLocation: {
								[ChatAgentLocation.Chat]: true,
								[ChatAgentLocation.EditorInline]: true
							}
						} satisfies ILanguageModelChatMetadata,
						identifier: `${vendor}/${options.group}/shared-model`
					}];
				},
				sendChatRequest: async () => { throw new Error(); },
				provideTokenCount: async () => { throw new Error(); }
			}));
		}

		await service.selectLanguageModels({});

		const profileA = service.lookupLanguageModel('profile-vendor-a/Profile A/shared-model');
		const profileB = service.lookupLanguageModel('profile-vendor-b/Profile B/shared-model');

		assert.strictEqual(profileA?.isDefaultForLocation[ChatAgentLocation.Chat], false);
		assert.strictEqual(profileA?.isDefaultForLocation[ChatAgentLocation.EditorInline], false);
		assert.strictEqual(profileB?.isDefaultForLocation[ChatAgentLocation.Chat], true);
		assert.strictEqual(profileB?.isDefaultForLocation[ChatAgentLocation.EditorInline], true);
	});
});
