/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Dimension, getWindow } from '../../../../../../base/browser/dom.js';
import { DeferredPromise, timeout } from '../../../../../../base/common/async.js';
import { IStringDictionary } from '../../../../../../base/common/collections.js';
import { Emitter, Event as VSCodeEvent } from '../../../../../../base/common/event.js';
import { toDisposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { TestDialogService } from '../../../../../../platform/dialogs/test/common/testDialogService.js';
import { IConfirmation, IConfirmationResult } from '../../../../../../platform/dialogs/common/dialogs.js';
import { ExtensionIdentifier } from '../../../../../../platform/extensions/common/extensions.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ProviderSetupView } from '../../../browser/chatManagement/providerSetupEditor.js';
import { ILanguageModelChatMetadata, ILanguageModelChatSelector, ILanguageModelProviderDescriptor, ILanguageModelsProviderConnectionResult } from '../../../common/languageModels.js';
import { ILanguageModelsConfigurationService, ILanguageModelsProviderGroup } from '../../../common/languageModelsConfiguration.js';
import { NullLanguageModelsService } from '../../common/languageModels.js';

suite('ProviderSetupView', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createProviderA(): ILanguageModelsProviderGroup {
		return {
			name: 'Provider A',
			vendor: 'customoai',
			baseUrl: 'http://localhost:11434/v1',
			cachedModels: [{
				id: 'old-model',
				name: 'Old Model',
				maxInputTokens: 16_384,
				maxOutputTokens: 4_096
			}]
		};
	}

	function createProviderB(): ILanguageModelsProviderGroup {
		return {
			name: 'Provider B',
			vendor: 'customoai',
			baseUrl: 'http://localhost:1234/v1'
		};
	}

	function noModelsResult(): ILanguageModelsProviderConnectionResult {
		return { success: true, models: [], errorCode: 'noModels' };
	}

	function modelResult(id: string): ILanguageModelsProviderConnectionResult {
		return {
			success: true,
			models: [{
				id,
				name: id,
				maxInputTokens: 131_072,
				maxOutputTokens: 8_192,
				capabilities: { toolCalling: true }
			}]
		};
	}

	class RecordingDialogService extends TestDialogService {
		readonly confirmations: IConfirmation[] = [];

		override async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
			this.confirmations.push(confirmation);
			return super.confirm(confirmation);
		}
	}

	class TestLanguageModelsService extends NullLanguageModelsService {
		private readonly _onDidChangeModels = new Emitter<string>();
		override readonly onDidChangeLanguageModels = this._onDidChangeModels.event;
		readonly groups: ILanguageModelsProviderGroup[];
		readonly connectionResults: DeferredPromise<ILanguageModelsProviderConnectionResult>[] = [];
		readonly testRequests: { vendor: string; configuration: IStringDictionary<unknown> | undefined }[] = [];
		readonly updates: { group: ILanguageModelsProviderGroup; name: string; vendor: string; configuration: IStringDictionary<unknown> | undefined }[] = [];
		readonly adds: { name: string; vendor: string; configuration: IStringDictionary<unknown> | undefined }[] = [];
		readonly removes: { vendor: string; name: string }[] = [];
		readonly selectCalls: ILanguageModelChatSelector[] = [];
		readonly models = new Map<string, ILanguageModelChatMetadata>();
		updateGate: DeferredPromise<void> | undefined;
		addGate: DeferredPromise<void> | undefined;

		constructor(groups: ILanguageModelsProviderGroup[] = [createProviderA(), createProviderB()]) {
			super();
			this.groups = groups;
		}

		override getVendors(): ILanguageModelProviderDescriptor[] {
			return ['customoai', 'openai'].map(vendor => ({
				vendor,
				displayName: vendor === 'openai' ? 'OpenAI' : 'OpenAI-Compatible',
				configuration: undefined,
				managementCommand: undefined,
				when: undefined,
				isDefault: false
			}));
		}

		override getLanguageModelIds(): string[] {
			return Array.from(this.models.keys());
		}

		override lookupLanguageModel(identifier: string): ILanguageModelChatMetadata | undefined {
			return this.models.get(identifier);
		}

		addLiveModel(identifier: string, detail?: string): void {
			const separator = identifier.indexOf('/');
			const vendor = identifier.slice(0, separator);
			const id = identifier.slice(separator + 1);
			this.models.set(identifier, {
				extension: new ExtensionIdentifier('test.provider'),
				name: id,
				id,
				vendor,
				version: '1',
				detail,
				family: id,
				maxInputTokens: 32_768,
				maxOutputTokens: 4_096,
				isDefaultForLocation: {},
				modelPickerCategory: undefined,
				capabilities: { toolCalling: true }
			});
		}

		override async selectLanguageModels(selector: ILanguageModelChatSelector): Promise<string[]> {
			this.selectCalls.push(selector);
			return [];
		}

		override async testProviderConnection(vendor: string, configuration: IStringDictionary<unknown> | undefined): Promise<ILanguageModelsProviderConnectionResult> {
			this.testRequests.push({ vendor, configuration: configuration ? { ...configuration } : undefined });
			const result = new DeferredPromise<ILanguageModelsProviderConnectionResult>();
			this.connectionResults.push(result);
			return result.p;
		}

		override async updateLanguageModelsProviderGroup(group: ILanguageModelsProviderGroup, name: string, vendor: string, configuration: IStringDictionary<unknown> | undefined): Promise<void> {
			this.updates.push({ group, name, vendor, configuration: configuration ? { ...configuration } : undefined });
			const index = this.groups.findIndex(candidate => candidate === group || (candidate.vendor === group.vendor && candidate.name === group.name));
			const updated: ILanguageModelsProviderGroup = { name, vendor, ...(configuration ?? {}) };
			if (index >= 0) {
				this.groups.splice(index, 1, updated);
			}
			this._onDidChangeModels.fire(vendor);
			const gate = this.updateGate;
			this.updateGate = undefined;
			await gate?.p;
		}

		override async addLanguageModelsProviderGroup(name: string, vendor: string, configuration: IStringDictionary<unknown> | undefined): Promise<void> {
			this.adds.push({ name, vendor, configuration: configuration ? { ...configuration } : undefined });
			this.groups.push({ name, vendor, ...(configuration ?? {}) });
			this._onDidChangeModels.fire(vendor);
			const gate = this.addGate;
			this.addGate = undefined;
			await gate?.p;
		}

		override async removeLanguageModelsProviderGroup(vendor: string, name: string): Promise<void> {
			this.removes.push({ vendor, name });
			const index = this.groups.findIndex(group => group.vendor === vendor && group.name === name);
			if (index >= 0) {
				this.groups.splice(index, 1);
			}
			this._onDidChangeModels.fire(vendor);
		}

		fireModelsChanged(): void {
			this._onDidChangeModels.fire('customoai');
		}

		dispose(): void {
			this._onDidChangeModels.dispose();
		}
	}

	function createConfigurationService(service: TestLanguageModelsService): ILanguageModelsConfigurationService {
		return {
			_serviceBrand: undefined,
			configurationFile: URI.file('chatLanguageModels.json'),
			onDidChangeLanguageModelGroups: VSCodeEvent.None,
			getLanguageModelsProviderGroups: () => service.groups,
			addLanguageModelsProviderGroup: async group => group,
			updateLanguageModelsProviderGroup: async (_from, to) => to,
			removeLanguageModelsProviderGroup: async () => { },
			configureLanguageModels: async () => { }
		};
	}

	function renderView(
		service: TestLanguageModelsService,
		dialogService: RecordingDialogService = new RecordingDialogService()
	): { container: HTMLElement; view: ProviderSetupView; dialogService: RecordingDialogService } {
		const container = document.createElement('div');
		document.body.appendChild(container);
		disposables.add(service);
		disposables.add(toDisposable(() => container.remove()));
		const view = disposables.add(new ProviderSetupView(service, createConfigurationService(service), dialogService));
		view.render(container);
		return { container, view, dialogService };
	}

	function getProviderCard(container: HTMLElement, name: string): HTMLElement {
		const card = Array.from(container.querySelectorAll<HTMLElement>('.ps-provider-card'))
			.find(candidate => candidate.querySelector('.ps-provider-name')?.textContent === name);
		assert.ok(card, 'Expected provider card ' + name);
		return card;
	}

	function getButton(container: HTMLElement, label: string): HTMLButtonElement {
		const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
			.find(candidate => candidate.textContent?.trim().includes(label)
				|| candidate.getAttribute('aria-label')?.includes(label)
				|| candidate.title.includes(label));
		assert.ok(button, 'Expected button ' + label);
		return button;
	}

	function getControl<T extends HTMLInputElement | HTMLSelectElement>(container: HTMLElement, label: string): T {
		const labelElement = Array.from(container.querySelectorAll<HTMLLabelElement>('label'))
			.find(candidate => candidate.textContent?.trim().includes(label));
		assert.ok(labelElement?.htmlFor, 'Expected control label ' + label);
		const control = document.getElementById(labelElement.htmlFor);
		assert.ok(control && container.contains(control), 'Expected control ' + label);
		return control as T;
	}

	function setControlValue(control: HTMLInputElement | HTMLSelectElement, value: string): void {
		control.value = value;
		const targetWindow = getWindow(control);
		control.dispatchEvent(new targetWindow.Event('input', { bubbles: true }));
		control.dispatchEvent(new targetWindow.Event('change', { bubbles: true }));
	}

	async function waitFor(predicate: () => boolean, message: string): Promise<void> {
		for (let attempt = 0; attempt < 30; attempt++) {
			if (predicate()) {
				return;
			}
			await timeout(0);
		}
		assert.fail(message);
	}

	test('ignores a deferred Provider A test after selecting Provider B', async () => {
		const service = new TestLanguageModelsService();
		const { container } = renderView(service);

		getProviderCard(container, 'Provider A').click();
		getButton(container, 'Test Connection').click();
		assert.strictEqual(service.testRequests.length, 1);

		getProviderCard(container, 'Provider B').click();
		assert.ok(getProviderCard(container, 'Provider B').classList.contains('selected'));

		service.connectionResults[0].complete(modelResult('stale-model'));
		await timeout(0);

		assert.strictEqual(service.updates.length, 0);
		assert.ok(getProviderCard(container, 'Provider B').classList.contains('selected'));
		assert.strictEqual(container.querySelector('.ps-test-result'), null);
		assert.ok(!container.textContent?.includes('stale-model'));
	});

	test('serializes Test with every mutating operation', async () => {
		const service = new TestLanguageModelsService();
		const { container, dialogService } = renderView(service);
		getProviderCard(container, 'Provider A').click();

		getButton(container, 'Test Connection').click();
		assert.strictEqual(container.querySelector('.ps-editor')?.getAttribute('aria-busy'), 'true');
		for (const label of ['Save Changes', 'Refresh', 'Duplicate', 'Remove']) {
			const button = getButton(container, label);
			assert.strictEqual(button.disabled, true, label + ' must be disabled while Test runs');
			button.click();
		}
		assert.strictEqual(service.testRequests.length, 1);
		assert.strictEqual(service.updates.length, 0);
		assert.strictEqual(service.adds.length, 0);
		assert.strictEqual(service.removes.length, 0);
		assert.strictEqual(dialogService.confirmations.length, 0);

		service.connectionResults[0].complete(noModelsResult());
		await timeout(0);
		assert.strictEqual(container.querySelector('.ps-editor')?.getAttribute('aria-busy'), 'false');
		assert.strictEqual(getButton(container, 'Save Changes').disabled, false);
	});

	test('hide invalidates an active Test and show removes transient busy UI', async () => {
		const service = new TestLanguageModelsService();
		const { container, view } = renderView(service);
		getProviderCard(container, 'Provider A').click();
		getButton(container, 'Test Connection').click();
		assert.ok(container.querySelector('.ps-test-loading'));

		view.setVisible(false);
		view.setVisible(true);
		assert.strictEqual(container.querySelector('.ps-test-loading'), null);
		assert.strictEqual(container.querySelector('.ps-editor')?.getAttribute('aria-busy'), 'false');
		assert.strictEqual(getButton(container, 'Test Connection').disabled, false);
		assert.ok(!container.textContent?.includes('Testing...'));

		service.connectionResults[0].complete(modelResult('late-hidden-model'));
		await timeout(0);
		assert.strictEqual(service.updates.length, 0);
		assert.ok(!container.textContent?.includes('late-hidden-model'));
	});

	test('ordinary hide/show preserves draft DOM and catches up the sidebar list', () => {
		const service = new TestLanguageModelsService();
		const { container, view } = renderView(service);
		getProviderCard(container, 'Provider A').click();
		const baseUrl = getControl<HTMLInputElement>(container, 'Base URL / Endpoint');
		const manual = getControl<HTMLInputElement>(container, 'Or enter model ID manually');
		setControlValue(baseUrl, 'http://draft.example/v1');
		setControlValue(manual, 'draft-model');

		view.setVisible(false);
		service.groups.push({ name: 'Provider C', vendor: 'customoai', baseUrl: 'http://localhost:9999/v1' });
		service.fireModelsChanged();
		view.setVisible(true);

		assert.strictEqual(getControl<HTMLInputElement>(container, 'Base URL / Endpoint'), baseUrl);
		assert.strictEqual(baseUrl.value, 'http://draft.example/v1');
		assert.strictEqual(manual.value, 'draft-model');
		assert.ok(getProviderCard(container, 'Provider C'));
	});

	test('Save owns discovery persistence and maps exact model metadata', async () => {
		const service = new TestLanguageModelsService();
		const { container } = renderView(service);
		getProviderCard(container, 'Provider A').click();
		getButton(container, 'Save Changes').click();
		await waitFor(() => service.testRequests.length === 1, 'Save did not start one connection request');

		service.connectionResults[0].complete({
			success: true,
			models: [{
				id: 'exact-model',
				name: 'Exact Model',
				maxInputTokens: 131_072,
				maxOutputTokens: 8_192,
				capabilities: {
					vision: true,
					toolCalling: true,
					agentMode: true,
					editTools: ['apply_patch']
				},
				tokens: 1
			}]
		});
		await waitFor(() => service.updates.length === 1, 'Save did not persist discovered models');

		assert.strictEqual(service.testRequests.length, 1);
		assert.strictEqual(service.selectCalls.length, 0);
		const cachedModels = service.updates[0].configuration?.cachedModels as Record<string, unknown>[];
		assert.deepStrictEqual(cachedModels, [{
			id: 'exact-model',
			name: 'Exact Model',
			maxInputTokens: 131_072,
			maxOutputTokens: 8_192,
			vision: true,
			toolCalling: true,
			agentMode: true,
			editTools: ['apply_patch']
		}]);
		assert.strictEqual(Object.prototype.hasOwnProperty.call(cachedModels[0], 'tokens'), false);
		assert.ok(getProviderCard(container, 'Provider A').classList.contains('selected'));
	});

	test('Save commits once and reports a failed preflight honestly', async () => {
		const service = new TestLanguageModelsService([createProviderA()]);
		const { container } = renderView(service);
		getProviderCard(container, 'Provider A').click();
		getButton(container, 'Save Changes').click();
		await waitFor(() => service.testRequests.length === 1, 'Save preflight was not issued');
		service.connectionResults[0].complete({ success: false, models: [], errorCode: 'unreachable' });
		await waitFor(() => service.updates.length === 1, 'failed preflight must not prevent saving the draft');

		assert.strictEqual(service.testRequests.length, 1);
		assert.strictEqual(service.updates.length, 1);
		assert.ok(container.querySelector('.ps-operation-error')?.textContent?.includes('Provider saved'));
		assert.strictEqual(container.querySelector('.ps-editor')?.getAttribute('aria-busy'), 'false');
	});

	test('Save round-trips the explicit default profile checkbox', async () => {
		const service = new TestLanguageModelsService([createProviderA()]);
		const { container } = renderView(service);
		getProviderCard(container, 'Provider A').click();
		const checkbox = getControl<HTMLInputElement>(container, 'Use this profile as the global Chat and Edit default');
		checkbox.checked = true;
		checkbox.dispatchEvent(new Event('change', { bubbles: true }));

		getButton(container, 'Save Changes').click();
		await waitFor(() => service.testRequests.length === 1, 'Save preflight was not issued');
		service.connectionResults[0].complete(noModelsResult());
		await waitFor(() => service.updates.length === 1, 'Save update was not issued');

		assert.strictEqual(service.updates[0].configuration?.isDefaultProfile, true);
	});

	test('Save explicitly hands selection from the old name to the renamed group', async () => {
		const service = new TestLanguageModelsService();
		service.updateGate = new DeferredPromise<void>();
		const gate = service.updateGate;
		const { container } = renderView(service);
		getProviderCard(container, 'Provider A').click();
		setControlValue(getControl<HTMLInputElement>(container, 'Display Name'), 'Renamed Provider');
		getButton(container, 'Save Changes').click();

		await waitFor(() => service.testRequests.length === 1, 'Rename probe was not issued');
		service.connectionResults[0].complete(noModelsResult());
		await waitFor(() => service.updates.length === 1, 'Rename update was not issued');
		assert.ok(getProviderCard(container, 'Renamed Provider'));
		assert.ok(container.textContent?.includes('Edit Provider'));
		gate.complete();
		await waitFor(() => getProviderCard(container, 'Renamed Provider').classList.contains('selected'), 'Rename did not adopt the committed identity');
		assert.ok(getProviderCard(container, 'Renamed Provider').classList.contains('selected'));
		await timeout(0);
		assert.strictEqual(service.testRequests.length, 1);
		assert.strictEqual(service.updates.length, 1);
		assert.ok(getProviderCard(container, 'Renamed Provider').classList.contains('selected'));
		assert.strictEqual(getButton(container, 'Save Changes').disabled, false);
	});

	test('Save rejects a rename collision before probe or commit', async () => {
		const service = new TestLanguageModelsService();
		const { container } = renderView(service);
		getProviderCard(container, 'Provider A').click();
		setControlValue(getControl<HTMLInputElement>(container, 'Display Name'), 'Provider B');
		getButton(container, 'Save Changes').click();
		await timeout(0);

		assert.strictEqual(service.testRequests.length, 0);
		assert.strictEqual(service.updates.length, 0);
		assert.ok(container.querySelector('.ps-operation-error')?.textContent?.includes('already exists'));
		assert.ok(getProviderCard(container, 'Provider A').classList.contains('selected'));
		assert.strictEqual(container.querySelector('.ps-editor')?.getAttribute('aria-busy'), 'false');
	});

	test('Add explicitly hands selection from catalog to the saved group', async () => {
		const service = new TestLanguageModelsService([]);
		service.addGate = new DeferredPromise<void>();
		const gate = service.addGate;
		const { container } = renderView(service);
		setControlValue(getControl<HTMLInputElement>(container, 'Display Name'), 'New Endpoint');
		setControlValue(getControl<HTMLInputElement>(container, 'Base URL / Endpoint'), 'http://new.example/v1');
		getButton(container, 'Add Provider').click();

		await waitFor(() => service.testRequests.length === 1, 'Add probe was not issued');
		service.connectionResults[0].complete(noModelsResult());
		await waitFor(() => service.adds.length === 1, 'Add was not issued');
		assert.ok(getProviderCard(container, 'New Endpoint'));
		gate.complete();
		await waitFor(() => getProviderCard(container, 'New Endpoint').classList.contains('selected'), 'Add did not adopt the committed identity');
		assert.ok(getProviderCard(container, 'New Endpoint').classList.contains('selected'));
		await timeout(0);
		assert.strictEqual(service.testRequests.length, 1);
		assert.strictEqual(service.adds.length, 1);
		assert.ok(getProviderCard(container, 'New Endpoint').classList.contains('selected'));
	});

	test('Refresh probes an existing unsaved draft without persistence and offers fresh models', async () => {
		const service = new TestLanguageModelsService([createProviderA()]);
		const { container } = renderView(service);
		getProviderCard(container, 'Provider A').click();
		setControlValue(getControl<HTMLInputElement>(container, 'Base URL / Endpoint'), 'http://edited.example/v1');
		setControlValue(getControl<HTMLInputElement>(container, 'Or enter model ID manually'), 'manual-one');
		assert.strictEqual(getControl<HTMLSelectElement>(container, 'Default chat model').value, 'customoai/old-model');

		getButton(container, 'Refresh').click();
		assert.strictEqual(service.testRequests.length, 1);
		assert.strictEqual(service.testRequests[0].configuration?.baseUrl, 'http://edited.example/v1');
		assert.deepStrictEqual(service.testRequests[0].configuration?.manualModels, ['manual-one']);
		assert.strictEqual(service.testRequests[0].configuration?.defaultChatModel, 'old-model');
		service.connectionResults[0].complete(modelResult('fresh-model'));
		await timeout(0);

		assert.strictEqual(service.updates.length, 0);
		assert.strictEqual(service.adds.length, 0);
		assert.strictEqual(service.selectCalls.length, 0);
		assert.strictEqual(getControl<HTMLInputElement>(container, 'Base URL / Endpoint').value, 'http://edited.example/v1');
		assert.strictEqual(getControl<HTMLInputElement>(container, 'Or enter model ID manually').value, 'manual-one');
		assert.strictEqual(getControl<HTMLSelectElement>(container, 'Default chat model').value, 'customoai/fresh-model');
	});

	test('Refresh probes a new catalog draft with its current endpoint and defaults', async () => {
		const service = new TestLanguageModelsService([]);
		service.addLiveModel('customoai/catalog-model');
		const { container } = renderView(service);
		setControlValue(getControl<HTMLInputElement>(container, 'Display Name'), 'Draft Endpoint');
		setControlValue(getControl<HTMLInputElement>(container, 'Base URL / Endpoint'), 'http://catalog.example/v1');
		setControlValue(getControl<HTMLInputElement>(container, 'Or enter model ID manually'), 'manual-catalog');
		setControlValue(getControl<HTMLSelectElement>(container, 'Default chat model'), 'customoai/catalog-model');

		getButton(container, 'Refresh').click();
		assert.strictEqual(service.testRequests.length, 1);
		assert.strictEqual(service.testRequests[0].configuration?.baseUrl, 'http://catalog.example/v1');
		assert.strictEqual(service.testRequests[0].configuration?.defaultChatModel, 'catalog-model');
		assert.deepStrictEqual(service.testRequests[0].configuration?.manualModels, ['manual-catalog']);
		service.connectionResults[0].complete(modelResult('catalog-fresh'));
		await timeout(0);

		assert.strictEqual(service.updates.length, 0);
		assert.strictEqual(service.adds.length, 0);
		assert.strictEqual(service.selectCalls.length, 0);
		assert.strictEqual(getControl<HTMLInputElement>(container, 'Base URL / Endpoint').value, 'http://catalog.example/v1');
		assert.strictEqual(getControl<HTMLSelectElement>(container, 'Default chat model').value, 'customoai/catalog-fresh');
	});

	test('Test on a new catalog draft preserves full defaults and never writes', async () => {
		const service = new TestLanguageModelsService([]);
		service.addLiveModel('customoai/catalog-model');
		const { container } = renderView(service);
		setControlValue(getControl<HTMLInputElement>(container, 'Display Name'), 'Test Draft');
		setControlValue(getControl<HTMLInputElement>(container, 'Base URL / Endpoint'), 'http://test.example/v1');
		setControlValue(getControl<HTMLInputElement>(container, 'Or enter model ID manually'), 'manual-test');
		for (const label of ['Default chat model', 'Default inline edit model', 'Compatibility fallback model']) {
			setControlValue(getControl<HTMLSelectElement>(container, label), 'customoai/catalog-model');
		}

		getButton(container, 'Test Connection').click();
		assert.strictEqual(service.testRequests.length, 1);
		service.connectionResults[0].complete(modelResult('catalog-model'));
		await timeout(0);

		assert.strictEqual(service.adds.length, 0);
		assert.strictEqual(service.updates.length, 0);
		assert.strictEqual(service.selectCalls.length, 0);
		assert.strictEqual(getControl<HTMLInputElement>(container, 'Base URL / Endpoint').value, 'http://test.example/v1');
		assert.strictEqual(getControl<HTMLInputElement>(container, 'Or enter model ID manually').value, 'manual-test');
		assert.strictEqual(getControl<HTMLSelectElement>(container, 'Default chat model').value, 'customoai/catalog-model');
	});

	test('stored required secret validates, removal blocks, and replacement clears removal', async () => {
		const storedSecret = '$' + '{input:stored-openai-key}';
		const service = new TestLanguageModelsService([{
			name: 'OpenAI',
			vendor: 'openai',
			apiKey: storedSecret,
			baseUrl: 'https://api.openai.com/v1'
		}]);
		const { container } = renderView(service);
		getProviderCard(container, 'OpenAI').click();
		const secret = getControl<HTMLInputElement>(container, 'API Key / Token');
		assert.strictEqual(secret.required, false);

		getButton(container, 'Test Connection').click();
		assert.strictEqual(service.testRequests.length, 1);
		assert.strictEqual(service.testRequests[0].configuration?.apiKey, storedSecret);
		service.connectionResults[0].complete(noModelsResult());
		await timeout(0);

		getButton(container, 'Remove stored secret').click();
		getButton(container, 'Test Connection').click();
		assert.strictEqual(service.testRequests.length, 1, 'removed required secret must fail validation');
		await timeout(0);

		setControlValue(secret, 'replacement-key');
		getButton(container, 'Save Changes').click();
		await waitFor(() => service.testRequests.length === 2, 'replacement probe was not issued');
		service.connectionResults[1].complete(noModelsResult());
		await waitFor(() => service.updates.length === 1, 'replacement was not saved');
		assert.strictEqual(service.updates[0].configuration?.apiKey, 'replacement-key');
		assert.notStrictEqual(service.updates[0].configuration?.apiKey, null);
		await timeout(0);
	});

	test('Remove requires confirmation and names the provider', async () => {
		const service = new TestLanguageModelsService();
		const dialogService = new RecordingDialogService();
		const { container } = renderView(service, dialogService);
		getProviderCard(container, 'Provider A').click();

		getButton(container, 'Remove').click();
		await timeout(0);
		assert.strictEqual(service.removes.length, 0);
		assert.strictEqual(dialogService.confirmations.length, 1);
		assert.ok(dialogService.confirmations[0].message.includes('Provider A'));

		dialogService.setConfirmResult({ confirmed: true });
		getButton(container, 'Remove').click();
		await waitFor(() => service.removes.length === 1, 'confirmed removal was not issued');
		assert.strictEqual(service.removes[0].name, 'Provider A');
		assert.strictEqual(container.querySelector('.ps-editor')?.getAttribute('aria-busy'), 'false');
	});

	test('a later operation supersedes the delayed Duplicate selection', async () => {
		const service = new TestLanguageModelsService([createProviderA()]);
		const { container } = renderView(service);
		getProviderCard(container, 'Provider A').click();
		getButton(container, 'Duplicate').click();
		await waitFor(() => service.adds.length === 1 && !getButton(container, 'Test Connection').disabled, 'Duplicate did not finish');
		assert.ok(getProviderCard(container, 'Provider A (Copy)'));

		getButton(container, 'Test Connection').click();
		service.connectionResults[0].complete(noModelsResult());
		await timeout(0);
		await timeout(2050);

		assert.ok(getProviderCard(container, 'Provider A').classList.contains('selected'));
		assert.ok(!getProviderCard(container, 'Provider A (Copy)').classList.contains('selected'));
	});

	test('uses container width for compact layout and does not focus while hidden', () => {
		const service = new TestLanguageModelsService();
		const { container, view } = renderView(service);
		const root = container.querySelector('.ps-editor');
		assert.ok(root);

		view.layout(new Dimension(700, 600));
		assert.ok(root.classList.contains('ps-compact'));
		view.layout(new Dimension(900, 600));
		assert.ok(!root.classList.contains('ps-compact'));

		const focusSentinel = document.createElement('button');
		container.appendChild(focusSentinel);
		focusSentinel.focus();
		view.setVisible(false);
		view.focus();
		assert.strictEqual(document.activeElement, focusSentinel);

		view.dispose();
		assert.strictEqual(container.querySelector('.ps-editor'), null);
	});

	test('uses the shared Pointer control primitives', () => {
		const service = new TestLanguageModelsService();
		const { container } = renderView(service);
		getProviderCard(container, 'Provider A').click();

		const root = container.querySelector('.ps-editor');
		assert.ok(root?.classList.contains('pointer-ui'));
		assert.ok(getButton(container, 'Save Changes').classList.contains('pointer-button-primary'));
		assert.ok(getButton(container, 'Test Connection').classList.contains('pointer-button-secondary'));
		assert.ok(getControl<HTMLInputElement>(container, 'Display Name').classList.contains('pointer-input'));
		assert.ok(getControl<HTMLSelectElement>(container, 'Default chat model').classList.contains('pointer-select'));
		assert.strictEqual(container.querySelector('.monaco-text-button'), null);
	});
});
