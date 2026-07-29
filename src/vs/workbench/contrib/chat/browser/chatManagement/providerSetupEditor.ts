/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/providerSetupEditor.css';
import * as DOM from '../../../../../base/browser/dom.js';
import { Dimension } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { localize } from '../../../../../nls.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import Severity from '../../../../../base/common/severity.js';
import { ILanguageModelsProviderConnectionModel, ILanguageModelsProviderConnectionResult, ILanguageModelsService, ILanguageModelProviderDescriptor } from '../../common/languageModels.js';
import { ILanguageModelsConfigurationService, ILanguageModelsProviderGroup } from '../../common/languageModelsConfiguration.js';
import { classifyProviderProcessingLocationForProvider } from './providerProcessingLocation.js';

type TestConnectionResult = ILanguageModelsProviderConnectionResult;

interface ProviderConfigSchema {
	properties?: Record<string, {
		type?: string;
		secret?: boolean;
		title?: string;
		description?: string;
		default?: string | number | boolean;
		enum?: string[];
	}>;
	required?: string[];
}

interface ProviderCatalogEntry {
	vendor: string;
	displayName: string;
	description: string;
	icon: string;
	category: 'configured' | 'cloud' | 'local' | 'custom';
	configuration?: ProviderConfigSchema;
	isMultiInstance?: boolean;
}

type ProviderStatus = 'connected' | 'error' | 'pending' | 'inactive' | 'testing';

const OPENAI_COMPATIBLE_FIELDS: NonNullable<ProviderConfigSchema['properties']> = {
	apiKey: { type: 'string', secret: true, title: 'API Key / Token', description: 'API key or token for this provider. Leave empty when Auth Type is None.' },
	baseUrl: { type: 'string', title: 'Base URL / Endpoint', description: 'OpenAI-compatible base URL, for example https://api.example.com/v1' },
	authType: { type: 'string', enum: ['bearer', 'header', 'none'], default: 'bearer', title: 'Auth Type', description: 'How Pointer sends authentication for model discovery and chat requests.' },
	customHeaderName: { type: 'string', title: 'Custom Header Name', description: 'Header name used when Auth Type is Header, for example api-key.' },
	modelsFetchUrl: { type: 'string', title: 'Model Fetch URL', description: 'Optional explicit models endpoint. Defaults to <Base URL>/models.' },
};

const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
	{ vendor: 'copilot', displayName: 'GitHub Copilot', description: 'GitHub AI models', icon: Codicon.github.id, category: 'configured' },
	{
		vendor: 'anthropic', displayName: 'Anthropic', description: 'Claude models via API key', icon: Codicon.edit.id, category: 'cloud',
		configuration: {
			properties: { apiKey: { type: 'string', secret: true, title: 'API Key', description: 'Anthropic API key' } },
			required: ['apiKey']
		}
	},
	{
		vendor: 'openai', displayName: 'OpenAI', description: 'GPT models via API key', icon: Codicon.sparkle.id, category: 'cloud',
		configuration: {
			properties: {
				...OPENAI_COMPATIBLE_FIELDS,
				baseUrl: { ...OPENAI_COMPATIBLE_FIELDS.baseUrl, default: 'https://api.openai.com/v1' },
			},
			required: ['apiKey']
		}
	},
	{
		vendor: 'gemini', displayName: 'Google Gemini', description: 'Gemini models via API key', icon: Codicon.cloud.id, category: 'cloud',
		configuration: {
			properties: { apiKey: { type: 'string', secret: true, title: 'API Key', description: 'Google Gemini API key' } },
			required: ['apiKey']
		}
	},
	{
		vendor: 'openrouter', displayName: 'OpenRouter', description: 'Access many models through one API', icon: Codicon.server.id, category: 'cloud',
		configuration: {
			properties: {
				...OPENAI_COMPATIBLE_FIELDS,
				baseUrl: { ...OPENAI_COMPATIBLE_FIELDS.baseUrl, default: 'https://openrouter.ai/api/v1' },
			},
			required: ['apiKey']
		}
	},
	{
		vendor: 'xai', displayName: 'xAI (Grok)', description: 'Grok models via API key', icon: Codicon.sparkle.id, category: 'cloud',
		configuration: {
			properties: {
				...OPENAI_COMPATIBLE_FIELDS,
				baseUrl: { ...OPENAI_COMPATIBLE_FIELDS.baseUrl, default: 'https://api.x.ai/v1' },
			},
			required: ['apiKey']
		}
	},
	{
		vendor: 'zai', displayName: 'Z.AI', description: 'GLM Coding Plan models via Z.AI API', icon: Codicon.sparkle.id, category: 'cloud',
		configuration: {
			properties: {
				...OPENAI_COMPATIBLE_FIELDS,
				baseUrl: { ...OPENAI_COMPATIBLE_FIELDS.baseUrl, default: 'https://api.z.ai/api/coding/paas/v4' },
			},
			required: ['apiKey']
		}
	},
	{
		vendor: 'groq', displayName: 'Groq', description: 'Fast open-source models via API key', icon: Codicon.server.id, category: 'cloud',
		configuration: {
			properties: {
				...OPENAI_COMPATIBLE_FIELDS,
				baseUrl: { ...OPENAI_COMPATIBLE_FIELDS.baseUrl, default: 'https://api.groq.com/openai/v1' },
			},
			required: ['apiKey']
		}
	},
	{
		vendor: 'azure', displayName: 'Azure OpenAI', description: 'Azure OpenAI deployments', icon: Codicon.cloud.id, category: 'cloud',
		configuration: {
			properties: {
				apiKey: { type: 'string', secret: true, title: 'API Key', description: 'Azure OpenAI API key' },
				endpoint: { type: 'string', title: 'Endpoint URL', description: 'Azure OpenAI endpoint (e.g. https://your-resource.openai.azure.com)' },
				deployment: { type: 'string', title: 'Deployment Name', description: 'Model deployment name' }
			},
			required: ['apiKey', 'endpoint']
		}
	},
	{
		vendor: 'ollama', displayName: 'Ollama', description: 'Local models running on your machine', icon: Codicon.serverEnvironment.id, category: 'local',
		configuration: {
			properties: { url: { type: 'string', title: 'URL', description: 'Ollama server endpoint', default: 'http://localhost:11434' } },
			required: ['url']
		}
	},
	{
		vendor: 'lmstudio', displayName: 'LM Studio', description: 'Local OpenAI-compatible server', icon: Codicon.chip.id, category: 'local',
		configuration: {
			properties: {
				baseUrl: { type: 'string', title: 'Base URL / Endpoint', description: 'LM Studio OpenAI-compatible endpoint', default: 'http://localhost:1234/v1' },
				authType: { type: 'string', enum: ['bearer', 'header', 'none'], default: 'none', title: 'Auth Type', description: 'LM Studio usually does not require authentication.' },
				apiKey: { type: 'string', secret: true, title: 'API Key / Token', description: 'Optional API key if your local server requires one.' },
			},
			required: ['baseUrl']
		}
	},
	{
		vendor: 'customoai', displayName: 'OpenAI-Compatible', description: 'Any OpenAI-compatible endpoint', icon: Codicon.wrench.id, category: 'custom',
		isMultiInstance: true,
		configuration: {
			properties: {
				...OPENAI_COMPATIBLE_FIELDS,
				baseUrl: { ...OPENAI_COMPATIBLE_FIELDS.baseUrl, title: 'Base URL / Endpoint', description: 'OpenAI-compatible base URL, for example https://api.z.ai/api/coding/paas/v4' }
			},
			required: ['baseUrl']
		}
	},
];

const CATEGORY_ORDER: ('configured' | 'cloud' | 'local' | 'custom')[] = ['configured', 'cloud', 'local', 'custom'];

const CATEGORY_LABELS: Record<string, string> = {
	configured: localize('ps.category.configured', 'Configured'),
	cloud: localize('ps.category.cloud', 'Cloud Providers'),
	local: localize('ps.category.local', 'Local Providers'),
	custom: localize('ps.category.custom', 'Custom Endpoints'),
};

const CATEGORY_ICONS: Record<string, string> = {
	configured: Codicon.check.id,
	cloud: Codicon.cloud.id,
	local: Codicon.serverEnvironment.id,
	custom: Codicon.wrench.id,
};

const PROVIDER_ICONS: Record<string, string> = {
	ollama: Codicon.serverEnvironment.id,
	anthropic: Codicon.edit.id,
	openai: Codicon.sparkle.id,
	gemini: Codicon.cloud.id,
	openrouter: Codicon.server.id,
	xai: Codicon.sparkle.id,
	zai: Codicon.sparkle.id,
	groq: Codicon.server.id,
	azure: Codicon.cloud.id,
	customoai: Codicon.wrench.id,
	copilot: Codicon.github.id,
	lmstudio: Codicon.chip.id,
};

const $ = DOM.$;

interface SidebarEntry {
	type: 'catalog' | 'group';
	catalog?: ProviderCatalogEntry;
	group?: ILanguageModelsProviderGroup;
	vendor: string;
	displayName: string;
	icon: string;
	status: ProviderStatus;
}

type ProviderFormInput = {
	key: string;
	input: HTMLInputElement | HTMLSelectElement;
	secret: boolean;
	required?: boolean;
};

interface DefaultModelControls {
	defaultChatModel: HTMLSelectElement;
	defaultCodingModel: HTMLSelectElement;
	fastModel: HTMLSelectElement;
	manualModels: HTMLInputElement;
	isDefaultProfile: HTMLInputElement;
}

interface RecommendedModelDefaults {
	defaultChatModel: string;
	defaultCodingModel: string;
	fastModel: string;
}

export class ProviderSetupView extends Disposable {
	private _dimension: Dimension | undefined;
	private _root: HTMLElement | undefined;

	private _sidebar: HTMLElement | undefined;
	private _sidebarBody: HTMLElement | undefined;
	private _detail: HTMLElement | undefined;
	private _detailBody: HTMLElement | undefined;
	private _detailFooter: HTMLElement | undefined;

	private _editingGroup: ILanguageModelsProviderGroup | undefined;
	private _selectedEntry: SidebarEntry | undefined;
	private _draftProviderName: string | undefined;
	private _draftProviderConfig: Record<string, unknown> | undefined;
	private _searchQuery = '';
	private _testResult: TestConnectionResult | undefined;
	private _isTesting = false;
	private _isVisible = true;
	private _operationSequence = 0;
	private _operationError: string | undefined;
	private _controlIdPool = 0;
	private _viewDisposables = this._register(new DisposableStore());
	private _detailDisposables = this._register(new DisposableStore());

	constructor(
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
		@ILanguageModelsConfigurationService private readonly _configService: ILanguageModelsConfigurationService,
		@IDialogService private readonly _dialogService: IDialogService,
	) {
		super();
	}

	render(parent: HTMLElement): void {
		if (this._root) {
			return;
		}
		this._root = DOM.append(parent, $('div.ps-editor.pointer-ui'));
		this._buildLayout();
		this._register(this._languageModelsService.onDidChangeLanguageModels(() => this._refreshSidebar()));
		this._register(this._languageModelsService.onDidChangeLanguageModelVendors(() => this._refreshSidebar()));
		this._register(this._configService.onDidChangeLanguageModelGroups(() => this._refreshSidebar()));
		if (this._dimension) {
			this.layout(this._dimension);
		}
	}

	setVisible(visible: boolean): void {
		this._isVisible = visible;
		if (this._root) {
			this._root.style.display = visible ? '' : 'none';
		}
		if (!visible && this._isTesting) {
			this._invalidateOperation();
			this._testResult = undefined;
			this._renderDetailView();
		} else if (visible) {
			this._renderSidebarContent();
		}
	}

	layout(dimension: Dimension): void {
		this._dimension = dimension;
		this._root?.classList.toggle('ps-compact', dimension.width < 800);
	}

	focus(): void {
		if (!this._isVisible) {
			return;
		}
		const searchInput = this._root?.querySelector('.ps-search-input') as HTMLInputElement | undefined;
		searchInput?.focus();
	}

	clearState(): void {
		this._invalidateOperation();
		this._viewDisposables.clear();
		this._detailDisposables.clear();
	}

	override dispose(): void {
		this._invalidateOperation();
		this._root?.remove();
		this._root = undefined;
		super.dispose();
	}

	private _beginOperation(testing: boolean): number | undefined {
		if (this._root?.getAttribute('aria-busy') === 'true') {
			return undefined;
		}
		const operation = ++this._operationSequence;
		this._isTesting = testing;
		this._operationError = undefined;
		this._root?.setAttribute('aria-busy', 'true');
		for (const button of this._detail?.querySelectorAll('button') ?? []) {
			button.disabled = true;
		}
		this._renderSidebarContent();
		return operation;
	}

	private _isCurrentOperation(operation: number): boolean {
		return operation === this._operationSequence && !this._store.isDisposed;
	}

	private _finishOperation(operation: number, rerenderDetail = true): void {
		if (!this._isCurrentOperation(operation)) {
			return;
		}
		this._isTesting = false;
		this._root?.setAttribute('aria-busy', 'false');
		this._renderSidebarContent();
		if (rerenderDetail) {
			this._renderDetailView();
		} else {
			for (const button of this._detail?.querySelectorAll('button') ?? []) {
				button.disabled = false;
			}
		}
	}

	private _invalidateOperation(): void {
		this._operationSequence++;
		this._isTesting = false;
		this._root?.setAttribute('aria-busy', 'false');
	}

	private _setOperationError(message: string): void {
		this._operationError = message;
	}

	private _renderOperationError(container: HTMLElement): void {
		if (this._operationError) {
			DOM.append(container, $('div.ps-operation-error', { role: 'alert' }, this._operationError));
		}
	}

	private _buildLayout(): void {
		if (!this._root) { return; }
		DOM.clearNode(this._root);

		this._sidebar = DOM.append(this._root, $('div.ps-sidebar'));
		this._detail = DOM.append(this._root, $('div.ps-detail'));

		this._selectedEntry = this._selectedEntry ?? this._getInitialEntry();
		this._editingGroup = this._selectedEntry?.group;
		this._buildSidebar();
		this._renderDetailView();
	}

	private _buildSidebar(): void {
		if (!this._sidebar) { return; }
		DOM.clearNode(this._sidebar);

		const searchBar = DOM.append(this._sidebar, $('div.ps-sidebar-search'));
		const searchContainer = DOM.append(searchBar, $('div.ps-search-container'));
		const searchIcon = DOM.append(searchContainer, $('span.codicon'));
		searchIcon.className = ThemeIcon.asClassName(Codicon.search);

		const input = DOM.append(searchContainer, $('input.pointer-input.ps-search-input')) as HTMLInputElement;
		input.placeholder = localize('ps.search.placeholder', 'Search providers...');
		input.value = this._searchQuery;

		this._viewDisposables.add(DOM.addDisposableListener(input, DOM.EventType.INPUT, () => {
			this._searchQuery = input.value.trim().toLowerCase();
			this._refreshSidebar();
		}));

		this._sidebarBody = DOM.append(this._sidebar, $('div.ps-sidebar-body'));
		this._renderSidebarContent();

		requestAnimationFrame(() => input.focus());
	}

	private _refreshSidebar(): void {
		this._renderSidebarContent();
	}

	private _getEntryStatus(entry: SidebarEntry): ProviderStatus {
		if (this._isTesting && this._selectedEntry?.vendor === entry.vendor && this._selectedEntry?.displayName === entry.displayName) {
			return 'testing';
		}

		if (entry.group) {
			const vendorGroups = this._languageModelsService.getLanguageModelGroups(entry.vendor);
			const matchingGroup = vendorGroups.find(g => g.group?.name === entry.group?.name);
			if (matchingGroup?.status?.severity === Severity.Error) {
				return 'error';
			}
			const modelIds = this._languageModelsService.getLanguageModelIds().filter(id => {
				const model = this._languageModelsService.lookupLanguageModel(id);
				return model?.vendor === entry.vendor && model?.detail === entry.group?.name;
			});
			if (modelIds.length > 0) { return 'connected'; }
			return 'pending';
		}

		if (this._languageModelsService.getVendors().some(v => v.vendor === entry.vendor)) {
			const modelIds = this._languageModelsService.getLanguageModelIds().filter(id => id.startsWith(`${entry.vendor}/`));
			if (modelIds.length > 0) { return 'connected'; }
			return 'inactive';
		}
		return 'inactive';
	}

	private _buildSidebarEntries(): SidebarEntry[] {
		const groups = this._configService.getLanguageModelsProviderGroups();
		const entries: SidebarEntry[] = [];
		const configuredGroupKeys = new Set<string>();

		for (const group of groups) {
			if (group.vendor === 'copilot') { continue; }
			configuredGroupKeys.add(`${group.vendor}:${group.name}`);
			const catalog = PROVIDER_CATALOG.find(p => p.vendor === group.vendor);
			entries.push({
				type: 'group',
				group,
				vendor: group.vendor,
				displayName: group.name,
				icon: catalog?.icon ?? PROVIDER_ICONS[group.vendor] ?? Codicon.server.id,
				status: 'inactive'
			});
		}

		for (const catalog of PROVIDER_CATALOG) {
			if (catalog.vendor === 'copilot') { continue; }
			if (catalog.isMultiInstance) {
				entries.push({
					type: 'catalog',
					catalog,
					vendor: catalog.vendor,
					displayName: `+ ${catalog.displayName}`,
					icon: catalog.icon,
					status: 'inactive'
				});
			} else if (!configuredGroupKeys.has(`${catalog.vendor}:${catalog.displayName}`)) {
				entries.push({
					type: 'catalog',
					catalog,
					vendor: catalog.vendor,
					displayName: catalog.displayName,
					icon: catalog.icon,
					status: 'inactive'
				});
			}
		}

		return entries;
	}

	private _renderSidebarContent(): void {
		if (!this._sidebarBody) { return; }
		DOM.clearNode(this._sidebarBody);

		const entries = this._buildSidebarEntries();
		if (this._selectedEntry && !entries.some(entry => this._isSameEntry(entry, this._selectedEntry!))) {
			this._selectedEntry = this._getInitialEntry(entries);
			this._editingGroup = this._selectedEntry?.group;
		}

		const grouped: Record<string, SidebarEntry[]> = {};
		for (const entry of entries) {
			const group = this._resolveCategory(entry);
			if (!grouped[group]) { grouped[group] = []; }
			grouped[group].push(entry);
		}

		let hasContent = false;
		for (const cat of CATEGORY_ORDER) {
			const catEntries = grouped[cat];
			if (!catEntries || catEntries.length === 0) { continue; }

			if (this._searchQuery) {
				const filtered = catEntries.filter(e => {
					const q = this._searchQuery;
					return e.displayName.toLowerCase().includes(q) || e.vendor.toLowerCase().includes(q);
				});
				if (filtered.length === 0) { continue; }
				this._renderSidebarCategory(cat, filtered);
			} else {
				this._renderSidebarCategory(cat, catEntries);
			}
			hasContent = true;
		}

		if (!hasContent) {
			const emptyMsg = DOM.append(this._sidebarBody, $('div.ps-sidebar-empty'));
			DOM.append(emptyMsg, $('span.codicon.codicon-info'));
			DOM.append(emptyMsg, $('span', undefined, localize('ps.noResults', 'No providers found')));
		}
	}

	private _getInitialEntry(entries = this._buildSidebarEntries()): SidebarEntry | undefined {
		return entries.find(entry => entry.group) ?? entries.find(entry => entry.catalog?.isMultiInstance) ?? entries.find(entry => entry.type === 'catalog');
	}

	private _isSameEntry(a: SidebarEntry, b: SidebarEntry): boolean {
		return a.vendor === b.vendor && a.displayName === b.displayName && a.group?.name === b.group?.name;
	}

	private _resolveCategory(entry: SidebarEntry): string {
		if (entry.type === 'group') {
			const catalog = PROVIDER_CATALOG.find(p => p.vendor === entry.vendor);
			if (catalog?.category === 'custom') { return 'custom'; }
			if (catalog?.category === 'local') { return 'local'; }
			return 'configured';
		}
		return entry.catalog?.category ?? 'cloud';
	}

	private _renderSidebarCategory(category: string, entries: SidebarEntry[]): void {
		if (!this._sidebarBody) { return; }
		const section = DOM.append(this._sidebarBody, $('div.ps-category'));

		const header = DOM.append(section, $('div.ps-category-header'));
		const icon = DOM.append(header, $('span.codicon'));
		icon.className = ThemeIcon.asClassName(ThemeIcon.fromId(CATEGORY_ICONS[category] ?? Codicon.server.id));
		DOM.append(header, $('span', undefined, CATEGORY_LABELS[category] ?? category));
		DOM.append(header, $('span.ps-category-count', undefined, String(entries.length)));

		for (const entry of entries) {
			this._renderSidebarCard(section, entry);
		}
	}

	private _renderSidebarCard(container: HTMLElement, entry: SidebarEntry): void {
		const card = DOM.append(container, $('div.ps-provider-card'));
		card.tabIndex = 0;
		card.setAttribute('role', 'button');
		card.setAttribute('aria-label', entry.displayName);
		const status = this._getEntryStatus(entry);
		const isSelected = this._selectedEntry?.vendor === entry.vendor && this._selectedEntry?.displayName === entry.displayName;

		if (isSelected) { card.classList.add('selected'); }
		if (entry.type === 'catalog' && entry.catalog?.isMultiInstance) { card.classList.add('ps-add-card'); }

		const iconEl = DOM.append(card, $('div.ps-provider-icon'));
		iconEl.classList.add(status === 'error' ? 'error' : (status === 'connected' ? 'active' : 'pending'));
		iconEl.classList.add(...ThemeIcon.asClassNameArray(ThemeIcon.fromId(entry.icon)));

		const info = DOM.append(card, $('div.ps-provider-info'));
		DOM.append(info, $('div.ps-provider-name', undefined, entry.displayName));

		if (entry.group) {
			const catalog = PROVIDER_CATALOG.find(p => p.vendor === entry.vendor);
			const desc = catalog?.description ?? entry.vendor;
			DOM.append(info, $('div.ps-provider-desc', undefined, desc));
		} else if (entry.catalog) {
			DOM.append(info, $('div.ps-provider-desc', undefined, entry.catalog.description));
		}

		const statusEl = DOM.append(card, $('div.ps-provider-status'));
		const dot = DOM.append(statusEl, $('div.ps-status-dot'));
		dot.classList.add(status);
		statusEl.title = this._statusLabel(status);

		const selectEntry = () => {
			this._invalidateOperation();
			this._selectedEntry = entry;
			this._editingGroup = entry.group;
			this._clearDraftProviderState();
			this._testResult = undefined;
			this._operationError = undefined;
			this._renderSidebarContent();
			this._renderDetailView();
		};
		this._viewDisposables.add(DOM.addDisposableListener(card, DOM.EventType.CLICK, selectEntry));
		this._viewDisposables.add(DOM.addDisposableListener(card, DOM.EventType.KEY_DOWN, event => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				selectEntry();
			}
		}));
	}

	private _statusLabel(status: ProviderStatus): string {
		switch (status) {
			case 'connected': return localize('ps.sidebar.connected', 'Connected');
			case 'error': return localize('ps.sidebar.error', 'Error');
			case 'testing': return localize('ps.sidebar.testing', 'Testing');
			case 'pending': return localize('ps.sidebar.pending', 'Configuring');
			case 'inactive': return localize('ps.sidebar.inactive', 'Not connected');
		}
	}

	private _showEmptyDetail(): void {
		if (!this._detail) { return; }
		DOM.clearNode(this._detail);

		const empty = DOM.append(this._detail, $('div.ps-empty-state'));
		DOM.append(empty, $('div.ps-empty-state-title', undefined,
			localize('ps.empty.title', 'Language Models')));
		DOM.append(empty, $('div.ps-empty-state-text', undefined,
			localize('ps.empty.text', 'Select a provider on the left or add a custom OpenAI-compatible endpoint.')));

		const actions = DOM.append(empty, $('div.ps-empty-state-actions'));
		const addBtn = DOM.append(actions, $('button.pointer-button.pointer-button-primary'));
		DOM.append(addBtn, $('span.codicon.codicon-plus'));
		DOM.append(addBtn, $('span', undefined, localize('ps.empty.addProvider', 'Add Custom Provider')));
		this._viewDisposables.add(DOM.addDisposableListener(addBtn, DOM.EventType.CLICK, () => {
			const custom = PROVIDER_CATALOG.find(v => v.vendor === 'customoai');
			if (custom) {
				this._selectedEntry = { type: 'catalog', catalog: custom, vendor: custom.vendor, displayName: `+ ${custom.displayName}`, icon: custom.icon, status: 'inactive' };
				this._editingGroup = undefined;
				this._renderSidebarContent();
				this._renderDetailView();
			}
		}));
	}

	private _renderDetailView(): void {
		if (!this._detail || !this._selectedEntry) {
			this._showEmptyDetail();
			return;
		}

		if (this._selectedEntry.type === 'catalog' && this._selectedEntry.catalog?.isMultiInstance && !this._editingGroup) {
			this._renderNewCustomProviderView();
		} else {
			this._renderConfigureView();
		}
	}

	private _renderNewCustomProviderView(): void {
		if (!this._detail || !this._selectedEntry) { return; }
		this._detailDisposables.clear();
		DOM.clearNode(this._detail);

		const catalog = this._selectedEntry.catalog!;
		const registeredVendor = this._languageModelsService.getVendors().find(v => v.vendor === catalog.vendor);
		const configSchema = (catalog.configuration ?? registeredVendor?.configuration) as ProviderConfigSchema | undefined;
		const header = DOM.append(this._detail, $('div.ps-detail-header'));
		const title = DOM.append(header, $('div.ps-detail-title'));
		const titleIcon = DOM.append(title, $('span.codicon'));
		titleIcon.className = ThemeIcon.asClassName(ThemeIcon.fromId(catalog.icon));
		DOM.append(title, $('span', undefined, localize('ps.custom.addTitle', 'Add Custom Provider')));
		DOM.append(header, $('div.ps-detail-subtitle', undefined,
			localize('ps.custom.addDesc', 'Add a new OpenAI-compatible endpoint. You can add as many as you need.')));

		this._detailBody = DOM.append(this._detail, $('div.ps-detail-body'));
		const form = DOM.append(this._detailBody, $('div.ps-form'));

		const nameInput = this._renderFormField(form,
			localize('ps.form.name', 'Display Name'),
			this._draftProviderName ?? '',
			localize('ps.form.name.hint', 'A friendly name for this provider (e.g. "Z.AI", "LM Studio Server 1")'),
			false,
			true
		);

		const inputs: ProviderFormInput[] = [];
		if (configSchema?.properties) {
			for (const [key, propSchema] of Object.entries(configSchema.properties)) {
				if (typeof propSchema === 'boolean') { continue; }
				const defaultVal = propSchema.default !== undefined ? String(propSchema.default) : '';
				const val = this._getDraftProviderValue(key, defaultVal);
				const isSecret = !!propSchema.secret;

				const input = propSchema.enum
					? this._renderSelectField(form, propSchema.title ?? key, val, propSchema.description ?? '', propSchema.enum, !!configSchema.required?.includes(key))
					: this._renderFormField(form, propSchema.title ?? key, val, propSchema.description ?? '', isSecret, !!configSchema.required?.includes(key));
				inputs.push({ key, input, secret: isSecret, required: !!configSchema.required?.includes(key) });
			}
		}
		this._renderProcessingLocation(form, catalog.vendor, inputs);

		const defaults = this._renderDefaultModelsSection(form, catalog.vendor, undefined, undefined);
		this._renderResolvedModelsSection(form, catalog.vendor, undefined, () => this._refreshProvider(inputs, registeredVendor, nameInput, defaults));
		this._renderTestConnectionSection(form, inputs, registeredVendor, nameInput, defaults);

		this._detailFooter = DOM.append(this._detail, $('div.ps-detail-footer'));
		this._renderOperationError(this._detailFooter);
		const right = DOM.append(this._detailFooter, $('div.ps-detail-footer-right'));
		const cancelBtn = DOM.append(right, $('button.pointer-button.pointer-button-secondary', undefined,
			localize('ps.action.cancel', 'Cancel')));
		this._detailDisposables.add(DOM.addDisposableListener(cancelBtn, DOM.EventType.CLICK, () => {
			this._clearDraftProviderState();
			this._showEmptyDetail();
			this._selectedEntry = undefined;
			this._editingGroup = undefined;
			this._renderSidebarContent();
		}));

		const addBtn = DOM.append(right, $('button.pointer-button.pointer-button-primary', undefined,
			localize('ps.action.add', 'Add Provider')));
		this._detailDisposables.add(DOM.addDisposableListener(addBtn, DOM.EventType.CLICK, async () => {
			await this._saveProvider(nameInput.value, inputs, undefined, catalog.vendor, defaults, registeredVendor);
		}));

		if (this._isVisible) {
			requestAnimationFrame(() => this._isVisible && nameInput.focus());
		}
	}

	private _renderConfigureView(): void {
		if (!this._detail || !this._selectedEntry) { return; }

		this._detailDisposables.clear();
		DOM.clearNode(this._detail);

		const isEdit = !!this._editingGroup;
		const group = this._editingGroup;
		const vendorId = this._selectedEntry.vendor;
		const catalog = PROVIDER_CATALOG.find(p => p.vendor === vendorId);
		const registeredVendor = this._languageModelsService.getVendors().find(v => v.vendor === vendorId);
		const configSchema = (catalog?.configuration ?? registeredVendor?.configuration) as ProviderConfigSchema | undefined;
		const status = this._getEntryStatus(this._selectedEntry);

		const header = DOM.append(this._detail, $('div.ps-detail-header'));
		const title = DOM.append(header, $('div.ps-detail-title'));
		const titleIcon = DOM.append(title, $('span.codicon'));
		titleIcon.className = ThemeIcon.asClassName(ThemeIcon.fromId(this._selectedEntry.icon));
		DOM.append(title, $('span', undefined,
			isEdit ? localize('ps.configure.edit', 'Edit Provider') : localize('ps.configure.add', 'Configure {0}', this._selectedEntry.displayName)));
		DOM.append(header, $('div.ps-detail-subtitle', undefined, catalog?.description ?? ''));

		const badge = DOM.append(header, $('div.ps-detail-status-badge'));
		const badgeDot = DOM.append(badge, $('div.ps-status-dot'));
		badgeDot.classList.add(status);
		const statusTexts: Record<ProviderStatus, string> = {
			connected: localize('ps.status.connected', 'Connected'),
			error: localize('ps.status.error', 'Error'),
			pending: localize('ps.status.pending', 'Configuring'),
			inactive: localize('ps.status.notConfigured', 'Not connected'),
			testing: localize('ps.status.testing', 'Testing...'),
		};
		DOM.append(badge, $('span', undefined, statusTexts[status]));
		badge.classList.add(status === 'connected' ? 'connected' : (status === 'error' ? 'error' : 'not-configured'));

		this._detailBody = DOM.append(this._detail, $('div.ps-detail-body'));
		const form = DOM.append(this._detailBody, $('div.ps-form'));

		const nameInput = this._renderFormField(form,
			localize('ps.form.name', 'Display Name'),
			this._draftProviderName ?? (isEdit ? group!.name : (catalog?.displayName ?? '')),
			localize('ps.form.name.hint', 'A friendly name for this provider instance'),
			false,
			true
		);

		const inputs: ProviderFormInput[] = [];

		if (configSchema?.properties) {
			for (const [key, propSchema] of Object.entries(configSchema.properties)) {
				if (typeof propSchema === 'boolean') { continue; }
				const defaultVal = propSchema.default !== undefined ? String(propSchema.default) : '';
				const existingVal = isEdit && group ? String((group as Record<string, unknown>)[key] ?? '') : '';
				const val = this._getDraftProviderValue(key, existingVal || defaultVal);
				const isSecret = !!propSchema.secret;

				const input = propSchema.enum
					? this._renderSelectField(form, propSchema.title ?? key, val, propSchema.description ?? '', propSchema.enum, !!configSchema.required?.includes(key))
					: this._renderFormField(form, propSchema.title ?? key, val, propSchema.description ?? '', isSecret, !!configSchema.required?.includes(key));
				inputs.push({ key, input, secret: isSecret, required: !!configSchema.required?.includes(key) });
			}
		}
		this._renderProcessingLocation(form, vendorId, inputs);

		const defaults = this._renderDefaultModelsSection(form, vendorId, isEdit ? group?.name : undefined, group);
		this._renderResolvedModelsSection(form, vendorId, isEdit ? group?.name : undefined, () => this._refreshProvider(inputs, registeredVendor, nameInput, defaults));
		this._renderTestConnectionSection(form, inputs, registeredVendor, nameInput, defaults);

		this._detailFooter = DOM.append(this._detail, $('div.ps-detail-footer'));
		this._renderOperationError(this._detailFooter);
		const left = DOM.append(this._detailFooter, $('div.ps-detail-footer-left'));

		if (group && group.vendor !== 'copilot') {
			if (catalog?.isMultiInstance) {
				const dupBtn = DOM.append(left, $('button.pointer-button.pointer-button-secondary'));
				DOM.append(dupBtn, $('span.codicon.codicon-copy'));
				DOM.append(dupBtn, $('span', undefined, localize('ps.action.duplicate', 'Duplicate')));
				this._detailDisposables.add(DOM.addDisposableListener(dupBtn, DOM.EventType.CLICK, async () => {
					await this._duplicateGroup(group!);
				}));
			}

			const removeBtn = DOM.append(left, $('button.pointer-button.pointer-button-danger'));
			DOM.append(removeBtn, $('span', undefined, localize('ps.action.remove', 'Remove')));
			this._detailDisposables.add(DOM.addDisposableListener(removeBtn, DOM.EventType.CLICK, async () => {
				await this._removeGroup(group!);
			}));
		}

		const jsonBtn = DOM.append(left, $('button.pointer-button.pointer-button-secondary'));
		DOM.append(jsonBtn, $('span', undefined, localize('ps.action.json', 'Edit JSON')));
		this._detailDisposables.add(DOM.addDisposableListener(jsonBtn, DOM.EventType.CLICK, () => {
			this._configService.configureLanguageModels();
		}));

		const right = DOM.append(this._detailFooter, $('div.ps-detail-footer-right'));
		const cancelBtn = DOM.append(right, $('button.pointer-button.pointer-button-secondary', undefined,
			localize('ps.action.close', 'Close')));
		this._detailDisposables.add(DOM.addDisposableListener(cancelBtn, DOM.EventType.CLICK, () => {
			this._clearDraftProviderState();
			this._showEmptyDetail();
			this._selectedEntry = undefined;
			this._editingGroup = undefined;
			this._renderSidebarContent();
		}));

		const saveBtn = DOM.append(right, $('button.pointer-button.pointer-button-primary', undefined,
			isEdit ? localize('ps.action.save', 'Save Changes') : localize('ps.action.connect', 'Connect')));
		this._detailDisposables.add(DOM.addDisposableListener(saveBtn, DOM.EventType.CLICK, async () => {
			await this._saveProvider(nameInput.value, inputs, isEdit ? group : undefined, vendorId, defaults, registeredVendor);
		}));

		if (this._isVisible) {
			requestAnimationFrame(() => this._isVisible && nameInput.focus());
		}
	}

	private _renderProcessingLocation(form: HTMLElement, vendorId: string, inputs: readonly ProviderFormInput[]): void {
		const endpointInput = inputs.find(input => input.key === 'baseUrl' || input.key === 'url' || input.key === 'endpoint')?.input;
		const location = DOM.append(form, $('div.ps-processing-location'));
		const update = () => {
			const value = endpointInput?.value;
			const classification = classifyProviderProcessingLocationForProvider(value, vendorId, !!endpointInput);
			location.className = `ps-processing-location ${classification}`;
			location.textContent = classification === 'local'
				? localize('ps.processing.local', 'Local processing')
				: classification === 'remote'
					? localize('ps.processing.remote', 'Remote processing')
					: localize('ps.processing.unknown', 'Processing location unknown');
		};
		update();
		if (endpointInput) {
			this._detailDisposables.add(DOM.addDisposableListener(endpointInput, DOM.EventType.INPUT, update));
		}
	}

	private _renderResolvedModelsSection(form: HTMLElement, vendorId: string, groupName: string | undefined, refresh: () => Promise<void>): void {
		const group = groupName ? this._configService.getLanguageModelsProviderGroups().find(g => g.vendor === vendorId && g.name === groupName) : undefined;
		const modelIds = this._languageModelsService.getLanguageModelIds().filter(id => {
			if (!id.startsWith(`${vendorId}/`)) { return false; }
			const model = this._languageModelsService.lookupLanguageModel(id);
			if (groupName && model?.detail !== groupName) { return false; }
			if (!groupName && model?.detail) { return false; }
			return true;
		});

		const cachedModels = this._getCachedModelIds(group);
		const testedModelIds = this._selectedEntry?.vendor === vendorId && this._testResult?.success
			? this._testResult.models.map(model => `${vendorId}/${model.id}`)
			: [];
		const visibleModelIds = testedModelIds.length > 0 ? testedModelIds : modelIds.length > 0 ? modelIds : cachedModels;

		const section = DOM.append(form, $('div.ps-resolved-models-section'));
		const header = DOM.append(section, $('div.ps-model-section-header'));
		DOM.append(header, $('span', undefined, localize('ps.models.available', 'Available Models ({0})', visibleModelIds.length)));

		const refreshBtn = DOM.append(header, $('button.pointer-button.pointer-button-ghost.pointer-button-small')) as HTMLButtonElement;
		DOM.append(refreshBtn, $('span.codicon.codicon-refresh'));
		DOM.append(refreshBtn, $('span', undefined, localize('ps.models.refresh', 'Refresh')));
		this._detailDisposables.add(DOM.addDisposableListener(refreshBtn, DOM.EventType.CLICK, refresh));

		const modelList = DOM.append(section, $('div.ps-resolved-models-list'));
		if (visibleModelIds.length === 0) {
			DOM.append(modelList, $('div.ps-model-chip-more', undefined,
				localize('ps.models.none', 'No models cached yet. Save or refresh to discover models.')));
			return;
		}
		for (const modelId of visibleModelIds.slice(0, 50)) {
			const model = this._languageModelsService.lookupLanguageModel(modelId);
			const modelName = model?.name ?? modelId.replace(`${vendorId}/`, '');

			const chip = DOM.append(modelList, $('div.ps-model-chip'));
			DOM.append(chip, $('span.ps-model-chip-name', undefined, modelName));

			const meta: string[] = [];
			if (model?.maxInputTokens) {
				meta.push(model.maxInputTokens >= 1000000 ? `${(model.maxInputTokens / 1000000).toFixed(1)}M` : `${Math.round(model.maxInputTokens / 1000)}K`);
			}
			if (model?.capabilities?.toolCalling) {
				meta.push(localize('ps.cap.tool', 'Tools'));
			}
			if (model?.capabilities?.vision) {
				meta.push(localize('ps.cap.vision', 'Vision'));
			}
			if (meta.length > 0) {
				DOM.append(chip, $('span.ps-model-chip-meta', undefined, meta.join(' \u00B7 ')));
			}
		}

		if (visibleModelIds.length > 50) {
			DOM.append(modelList, $('div.ps-model-chip-more', undefined,
				localize('ps.models.more', '+ {0} more models', visibleModelIds.length - 50)));
		}
	}

	private _renderDefaultModelsSection(form: HTMLElement, vendorId: string, groupName: string | undefined, group: ILanguageModelsProviderGroup | undefined): DefaultModelControls {
		const section = DOM.append(form, $('div.ps-model-section'));
		DOM.append(section, $('div.ps-model-section-title', undefined,
			localize('ps.models.choose', 'Default Models')));

		const modelIds = this._languageModelsService.getLanguageModelIds().filter(id => {
			if (!id.startsWith(`${vendorId}/`)) { return false; }
			const model = this._languageModelsService.lookupLanguageModel(id);
			if (groupName && model?.detail !== groupName) { return false; }
			if (!groupName && model?.detail) { return false; }
			return true;
		});
		const testedModelIds = this._selectedEntry?.vendor === vendorId && this._testResult?.success
			? this._testResult.models.map(model => `${vendorId}/${model.id}`)
			: [];
		const cachedModelIds = this._getCachedModelIds(group);
		const optionModelIds = testedModelIds.length > 0 ? testedModelIds : modelIds.length > 0 ? modelIds : cachedModelIds;

		const modelRow = DOM.append(section, $('div.ps-model-row'));

		const fields = [
			{ label: localize('ps.model.chat', 'Default chat model'), id: 'defaultChatModel' },
			{ label: localize('ps.model.coding', 'Default inline edit model'), id: 'defaultCodingModel' },
			{ label: localize('ps.model.fast', 'Compatibility fallback model'), id: 'fastModel' },
		];

		const selects = new Map<string, HTMLSelectElement>();
		const recommendedDefaults = this._recommendDefaultModels(vendorId, optionModelIds);
		for (const field of fields) {
			const fieldEl = DOM.append(modelRow, $('div.ps-model-field'));
			const select = DOM.append(fieldEl, $('select.pointer-select.ps-model-select')) as HTMLSelectElement;
			const controlId = this._nextControlId(field.id);
			select.id = controlId;
			const label = DOM.append(fieldEl, $('label.ps-model-field-label', undefined, field.label)) as HTMLLabelElement;
			label.htmlFor = controlId;
			fieldEl.insertBefore(label, select);
			DOM.append(select, $('option', { value: '' }, localize('ps.model.select', 'Select a model...')));
			for (const modelId of optionModelIds) {
				const model = this._languageModelsService.lookupLanguageModel(modelId);
				const modelName = model?.name ?? modelId.replace(`${vendorId}/`, '');
				DOM.append(select, $('option', { value: modelId }, modelName));
			}
			const existingValue = this._getDraftProviderValue(field.id, String((group as Record<string, unknown> | undefined)?.[field.id] ?? ''));
			const qualifiedExistingValue = existingValue && !existingValue.startsWith(`${vendorId}/`) ? `${vendorId}/${existingValue}` : existingValue;
			select.value = optionModelIds.includes(qualifiedExistingValue)
				? qualifiedExistingValue
				: recommendedDefaults[field.id as keyof RecommendedModelDefaults] || '';
			selects.set(field.id, select);
		}

		const manualDiv = DOM.append(modelRow, $('div.ps-model-manual'));
		const manualInput = DOM.append(manualDiv, $('input.pointer-input.ps-model-manual-input')) as HTMLInputElement;
		const manualControlId = this._nextControlId('manualModels');
		manualInput.id = manualControlId;
		const manualLabel = DOM.append(manualDiv, $('label.ps-model-field-label', undefined, localize('ps.model.manual', 'Or enter model ID manually'))) as HTMLLabelElement;
		manualLabel.htmlFor = manualControlId;
		manualDiv.insertBefore(manualLabel, manualInput);
		manualInput.placeholder = 'e.g. gpt-4.1, claude-sonnet-4, qwen/qwen3-coder';
		const manualModels = this._draftProviderConfig?.manualModels ?? (group as Record<string, unknown> | undefined)?.manualModels;
		if (Array.isArray(manualModels)) {
			manualInput.value = manualModels.filter((model): model is string => typeof model === 'string').join(', ');
		}
		DOM.append(manualDiv, $('div.ps-model-manual-hint', undefined,
			localize('ps.model.manual.hint', 'Enter a model ID from the provider')));

		const defaultProfileRow = DOM.append(section, $('div.ps-default-profile'));
		const defaultProfile = DOM.append(defaultProfileRow, $('input', { type: 'checkbox' })) as HTMLInputElement;
		defaultProfile.type = 'checkbox';
		defaultProfile.id = this._nextControlId('isDefaultProfile');
		const defaultProfileLabel = DOM.append(defaultProfileRow, $('label', undefined,
			localize('ps.model.defaultProfile', 'Use this profile as the global Chat and Edit default'))) as HTMLLabelElement;
		defaultProfileLabel.htmlFor = defaultProfile.id;
		const draftDefaultProfile = this._draftProviderConfig?.isDefaultProfile;
		defaultProfile.checked = typeof draftDefaultProfile === 'boolean'
			? draftDefaultProfile
			: group?.isDefaultProfile === true;

		return {
			defaultChatModel: selects.get('defaultChatModel')!,
			defaultCodingModel: selects.get('defaultCodingModel')!,
			fastModel: selects.get('fastModel')!,
			manualModels: manualInput,
			isDefaultProfile: defaultProfile
		};
	}

	private _recommendDefaultModels(vendorId: string, modelIds: readonly string[]): RecommendedModelDefaults {
		const uniqueModelIds = Array.from(new Set(modelIds)).filter(modelId => modelId.startsWith(`${vendorId}/`));
		if (uniqueModelIds.length === 0) {
			return { defaultChatModel: '', defaultCodingModel: '', fastModel: '' };
		}
		return {
			defaultChatModel: this._pickBestModel(uniqueModelIds, 'chat'),
			defaultCodingModel: this._pickBestModel(uniqueModelIds, 'coding'),
			fastModel: this._pickBestModel(uniqueModelIds, 'fast')
		};
	}

	private _pickBestModel(modelIds: readonly string[], role: 'chat' | 'coding' | 'fast'): string {
		let bestModelId = modelIds[0] ?? '';
		let bestScore = Number.NEGATIVE_INFINITY;
		for (const modelId of modelIds) {
			const score = this._scoreModel(modelId, role);
			if (score > bestScore) {
				bestScore = score;
				bestModelId = modelId;
			}
		}
		return bestModelId;
	}

	private _scoreModel(modelId: string, role: 'chat' | 'coding' | 'fast'): number {
		const model = this._languageModelsService.lookupLanguageModel(modelId);
		const rawId = modelId.replace(/^[^/]+\//, '');
		const lower = `${rawId} ${model?.name ?? ''}`.toLowerCase();
		if (this._modelIdIncludesAny(lower, ['embedding', 'embed', 'whisper', 'tts', 'moderation', 'rerank'])) {
			return -10000;
		}

		let score = 0;
		if (model?.capabilities?.toolCalling) {
			score += 25;
		}
		if (model?.capabilities?.vision && role === 'chat') {
			score += 8;
		}
		score += Math.min((model?.maxInputTokens ?? 128000) / 10000, 30);

		switch (role) {
			case 'coding':
				if (this._modelIdIncludesAny(lower, ['coder', 'codex', 'codestral', 'deepseek-coder'])) { score += 90; }
				if (this._modelIdIncludesAny(lower, ['sonnet', 'gpt-4.1', 'qwen3', 'deepseek', 'gpt-5'])) { score += 55; }
				if (this._modelIdIncludesAny(lower, ['mini', 'flash', 'haiku', 'instant'])) { score += 10; }
				break;
			case 'fast':
				if (this._modelIdIncludesAny(lower, ['mini', 'flash', 'haiku', 'instant', '8b', 'small', 'lite'])) { score += 95; }
				if (this._modelIdIncludesAny(lower, ['opus', 'pro', '70b', '405b'])) { score -= 35; }
				break;
			case 'chat':
				if (this._modelIdIncludesAny(lower, ['gpt-5', 'opus', 'sonnet', 'gpt-4.1', 'gpt-4o', 'gemini-2.5-pro', 'grok-4'])) { score += 70; }
				if (this._modelIdIncludesAny(lower, ['mini', 'haiku', 'instant', '8b'])) { score -= 15; }
				break;
		}

		return score;
	}

	private _modelIdIncludesAny(value: string, needles: readonly string[]): boolean {
		return needles.some(needle => value.includes(needle));
	}

	private _renderTestConnectionSection(
		form: HTMLElement,
		inputs: ProviderFormInput[],
		vendor: ILanguageModelProviderDescriptor | undefined,
		nameInput: HTMLInputElement,
		defaults: DefaultModelControls
	): void {
		const section = DOM.append(form, $('div.ps-test-section'));

		const header = DOM.append(section, $('div.ps-test-header'));
		DOM.append(header, $('span', undefined, localize('ps.test.title', 'Verify Connection')));

		const testBtn = DOM.append(header, $('button.pointer-button.pointer-button-secondary.pointer-button-small')) as HTMLButtonElement;
		DOM.append(testBtn, $('span', undefined, localize('ps.test.button', 'Test Connection')));
		const testIcon = DOM.append(testBtn, $('span.codicon'));
		testIcon.className = ThemeIcon.asClassName(Codicon.debugStart);

		this._detailDisposables.add(DOM.addDisposableListener(testBtn, DOM.EventType.CLICK, async () => {
			if (this._isTesting) { return; }
			await this._runTestConnection(section, inputs, vendor, nameInput, defaults);
		}));

		if (this._testResult) {
			this._showTestResult(section, this._testResult);
		}
	}

	private async _runTestConnection(
		section: HTMLElement,
		inputs: ProviderFormInput[],
		vendor: ILanguageModelProviderDescriptor | undefined,
		nameInput: HTMLInputElement,
		defaults: DefaultModelControls
	): Promise<void> {
		const config = this._collectFormValues(inputs);
		this._collectDefaultModelValues(config, defaults);
		this._rememberDraftProviderState(nameInput.value, config);

		if (!this._validateProviderDraft(nameInput, inputs)) {
			return;
		}

		if (!vendor) {
			this._showTestResult(section, {
				success: false,
				models: [],
				error: localize('ps.test.vendorNotFound', 'Provider not registered. Install the corresponding extension first.')
			});
			return;
		}

		const operation = this._beginOperation(true);
		if (operation === undefined) {
			return;
		}
		this._testResult = undefined;
		const existingResult = section.querySelector('.ps-test-result');
		existingResult?.remove();
		const existingLoading = section.querySelector('.ps-test-loading');
		existingLoading?.remove();

		const loadingEl = DOM.append(section, $('div.ps-test-loading'));
		DOM.append(loadingEl, $('div.ps-spinner'));
		DOM.append(loadingEl, $('span', undefined, localize('ps.test.connecting', 'Testing connection to {0}...', nameInput.value.trim())));

		try {
			const result = await this._languageModelsService.testProviderConnection(vendor.vendor, config);
			if (!this._isCurrentOperation(operation)) {
				return;
			}
			this._testResult = result;
		} catch (err) {
			if (!this._isCurrentOperation(operation)) {
				return;
			}
			const msg = err instanceof Error ? err.message : String(err);
			this._testResult = { success: false, models: [], error: msg };
		} finally {
			loadingEl.remove();
		}
		if (this._testResult && this._testResult.models.length === 0) {
			this._showTestResult(section, this._testResult);
			this._finishOperation(operation, false);
		} else {
			this._finishOperation(operation);
		}
	}

	private async _refreshProvider(
		inputs: ProviderFormInput[],
		vendor: ILanguageModelProviderDescriptor | undefined,
		nameInput: HTMLInputElement,
		defaults: DefaultModelControls
	): Promise<void> {
		const section = this._detail?.querySelector('.ps-test-section') as HTMLElement | null;
		if (section) {
			await this._runTestConnection(section, inputs, vendor, nameInput, defaults);
		}
	}

	private _showTestResult(container: HTMLElement, result: TestConnectionResult): void {
		const existing = container.querySelector('.ps-test-result');
		existing?.remove();

		const el = DOM.append(container, $('div.ps-test-result'));
		el.classList.add(result.success ? 'ps-test-success' : 'ps-test-error');

		const icon = DOM.append(el, $('span.codicon'));
		icon.className = ThemeIcon.asClassName(result.success ? Codicon.check : Codicon.error);

		if (result.error) {
			const errorText = DOM.append(el, $('div.ps-test-error-text'));
			DOM.append(errorText, $('span', undefined, this._classifyError(result.error)));
		} else if (result.success && result.models.length === 0) {
			el.classList.add('ps-test-warning');
			DOM.append(el, $('span', undefined,
				localize('ps.test.noModels', 'Connection works, but no models were returned. You can enter a model ID manually.')));
		} else if (result.models.length > 0) {
			DOM.append(el, $('span', undefined,
				localize('ps.test.success', 'Connection successful! Found {0} models:', result.models.length)));
		}
	}

	private _classifyError(msg: string): string {
		const lower = msg.toLowerCase();
		if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden')) {
			return localize('ps.error.401', 'API key invalid or missing. Please check your API key and try again.');
		}
		if (lower.includes('404') || lower.includes('not found')) {
			return localize('ps.error.404', 'Models endpoint not found. Please check the Base URL is correct.');
		}
		if (lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('enotfound') || lower.includes('network') || lower.includes('fetch')) {
			return localize('ps.error.network', 'Endpoint unreachable. Check the URL and ensure the server is running.');
		}
		if (lower.includes('timeout') || lower.includes('timed out')) {
			return localize('ps.error.timeout', 'Connection timed out. The server did not respond in time.');
		}
		if (lower.includes('json') || lower.includes('parse') || lower.includes('invalid response')) {
			return localize('ps.error.json', 'Provider returned an invalid response. The endpoint may not be OpenAI-compatible.');
		}
		if (lower.includes('no models') || lower.includes('empty')) {
			return localize('ps.error.empty', 'Connection works, but no models were returned by the provider.');
		}
		return msg;
	}

	private _renderFormField(form: HTMLElement, label: string, value: string, hint: string, password: boolean, required: boolean): HTMLInputElement {
		const group = DOM.append(form, $('div.ps-form-group'));
		const labelEl = DOM.append(group, $('label.ps-form-label', undefined, label)) as HTMLLabelElement;
		if (required) {
			DOM.append(labelEl, $('span.ps-form-label-required', undefined, '*'));
		}

		const inputRow = DOM.append(group, $('div.ps-form-input-row'));
		const input = DOM.append(inputRow, $('input.pointer-input')) as HTMLInputElement;
		input.id = this._nextControlId('field');
		labelEl.htmlFor = input.id;
		input.type = password ? 'password' : 'text';
		input.value = value;

		if (password) {
			const hasStoredSecret = !!value && value.startsWith('${input:');
			input.value = hasStoredSecret ? '' : value;
			input.placeholder = hasStoredSecret
				? localize('ps.form.secret.saved', 'Stored securely. Type to replace.')
				: localize('ps.form.secret.placeholder', 'Enter a value...');
			if (hasStoredSecret) {
				input.dataset.hasSecret = 'true';
				input.title = localize('ps.form.secret.stored', 'Secret is stored securely. Leave empty to keep it, type to replace it.');
				const removeBtn = DOM.append(inputRow, $('button.pointer-button.pointer-button-ghost.pointer-button-icon.ps-secret-remove', { type: 'button' })) as HTMLButtonElement;
				removeBtn.title = localize('ps.form.secret.remove', 'Remove stored secret');
				DOM.append(removeBtn, $('span.codicon.codicon-trash'));
				this._detailDisposables.add(DOM.addDisposableListener(removeBtn, DOM.EventType.CLICK, () => {
					delete input.dataset.hasSecret;
					input.dataset.secretRemoved = 'true';
					input.value = '';
					input.placeholder = localize('ps.form.secret.removed', 'Secret will be removed when you save.');
					removeBtn.disabled = true;
					input.focus();
				}));
			}
		}
		if (hint) {
			DOM.append(group, $('div.ps-form-hint', undefined, hint));
		}

		this._detailDisposables.add(DOM.addDisposableListener(input, DOM.EventType.INPUT, () => {
			if (input.value) {
				delete input.dataset.secretRemoved;
				delete input.dataset.hasSecret;
			}
			input.classList.remove('ps-form-input-error');
			input.removeAttribute('aria-invalid');
			const errEl = input.parentElement?.querySelector('.ps-form-error') as HTMLElement | undefined;
			errEl?.remove();
		}));

		return input;
	}

	private _renderSelectField(form: HTMLElement, label: string, value: string, hint: string, options: string[], required: boolean): HTMLSelectElement {
		const group = DOM.append(form, $('div.ps-form-group'));
		const labelEl = DOM.append(group, $('label.ps-form-label', undefined, label)) as HTMLLabelElement;
		if (required) {
			DOM.append(labelEl, $('span.ps-form-label-required', undefined, '*'));
		}

		const select = DOM.append(group, $('select.pointer-select')) as HTMLSelectElement;
		select.id = this._nextControlId('select');
		labelEl.htmlFor = select.id;
		for (const option of options) {
			DOM.append(select, $('option', { value: option }, option === 'none' ? localize('ps.auth.none', 'None') : option === 'header' ? localize('ps.auth.header', 'Header') : localize('ps.auth.bearer', 'Bearer')));
		}
		select.value = value || options[0] || '';
		if (hint) {
			DOM.append(group, $('div.ps-form-hint', undefined, hint));
		}
		return select;
	}

	private _nextControlId(name: string): string {
		return `ps-provider-${name}-${++this._controlIdPool}`;
	}

	private _validateProviderDraft(nameInput: HTMLInputElement, inputs: readonly ProviderFormInput[]): boolean {
		let valid = true;
		if (!nameInput.value.trim()) {
			this._markInvalid(nameInput, localize('ps.error.nameRequired', 'Display name is required'));
			valid = false;
		}
		for (const input of inputs) {
			if (!input.required) {
				continue;
			}
			const hasStoredSecret = input.secret
				&& input.input instanceof HTMLInputElement
				&& input.input.dataset.hasSecret === 'true'
				&& input.input.dataset.secretRemoved !== 'true';
			if (!input.input.value.trim() && !hasStoredSecret) {
				this._markInvalid(input.input, localize('ps.error.required', 'This field is required'));
				valid = false;
			}
		}
		return valid;
	}

	private _markInvalid(input: HTMLInputElement | HTMLSelectElement, message: string): void {
		input.classList.add('ps-form-input-error');
		input.setAttribute('aria-invalid', 'true');
		if (!input.parentElement?.querySelector('.ps-form-error')) {
			DOM.append(input.parentElement ?? input, $('div.ps-form-error', undefined, message));
		}
	}

	private _collectFormValues(inputs: ProviderFormInput[]): Record<string, unknown> {
		const config: Record<string, unknown> = {};
		for (const { key, input, secret } of inputs) {
			if (secret && input instanceof HTMLInputElement && input.dataset.secretRemoved === 'true') {
				config[key] = null;
				continue;
			}
			if (secret && input instanceof HTMLInputElement && input.dataset.hasSecret === 'true' && !input.value) {
				const existingValue = this._editingGroup ? (this._editingGroup as Record<string, unknown>)[key] : undefined;
				if (typeof existingValue === 'string') {
					config[key] = existingValue;
				}
				continue;
			}
			if (secret && input instanceof HTMLInputElement && !input.value) {
				continue;
			}
			config[key] = input.value;
		}
		return config;
	}

	private _rememberDraftProviderState(name: string, config: Record<string, unknown>): void {
		this._draftProviderName = name;
		this._draftProviderConfig = { ...config };
	}

	private _clearDraftProviderState(): void {
		this._draftProviderName = undefined;
		this._draftProviderConfig = undefined;
	}

	private _getDraftProviderValue(key: string, fallback: string): string {
		const value = this._draftProviderConfig?.[key];
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			return String(value);
		}
		return fallback;
	}

	private _getCachedModelIds(group: ILanguageModelsProviderGroup | undefined): string[] {
		if (!group) {
			return [];
		}
		const cachedModels = (group as Record<string, unknown>).cachedModels;
		const manualModels = (group as Record<string, unknown>).manualModels;
		const ids = new Set<string>();
		if (Array.isArray(cachedModels)) {
			for (const model of cachedModels) {
				if (model && typeof model === 'object' && typeof (model as Record<string, unknown>).id === 'string') {
					ids.add(`${group.vendor}/${(model as Record<string, string>).id}`);
				}
			}
		}
		if (Array.isArray(manualModels)) {
			for (const model of manualModels) {
				if (typeof model === 'string' && model.trim()) {
					ids.add(`${group.vendor}/${model.trim()}`);
				}
			}
		}
		return Array.from(ids);
	}

	private async _saveProvider(
		name: string,
		inputs: ProviderFormInput[],
		existing: ILanguageModelsProviderGroup | undefined,
		vendorId: string,
		defaults: DefaultModelControls,
		vendor: ILanguageModelProviderDescriptor | undefined
	): Promise<void> {
		const trimmedName = name.trim();
		const config = this._collectFormValues(inputs);
		this._collectDefaultModelValues(config, defaults);
		this._rememberDraftProviderState(name, config);
		const nameInput = this._detail?.querySelector<HTMLInputElement>('.ps-form input.pointer-input');
		if (!nameInput || !this._validateProviderDraft(nameInput, inputs)) {
			return;
		}
		if (this._configService.getLanguageModelsProviderGroups().some(group =>
			group.vendor === vendorId
			&& group.name === trimmedName
			&& !(existing && group.vendor === existing.vendor && group.name === existing.name))) {
			this._setOperationError(localize('ps.error.duplicateProvider', 'A provider named "{0}" already exists.', trimmedName));
			this._renderDetailView();
			return;
		}
		if (!vendor) {
			this._setOperationError(localize('ps.test.vendorNotFound', 'Provider not registered. Install the corresponding extension first.'));
			this._renderDetailView();
			return;
		}

		if (existing) {
			const cachedModels = (existing as Record<string, unknown>).cachedModels;
			if (Array.isArray(cachedModels)) {
				config.cachedModels = cachedModels;
			}
		}

		const operation = this._beginOperation(false);
		if (operation === undefined) {
			return;
		}
		try {
			const preflight = await this._languageModelsService.testProviderConnection(vendorId, config);
			if (!this._isCurrentOperation(operation)) {
				return;
			}
			this._testResult = preflight;
			if (preflight.success && preflight.models.length > 0) {
				config.cachedModels = preflight.models.map(model => this._toCachedModel(model));
			}
			this._applyRecommendedDefaultModelValues(config, vendorId);

			if (existing) {
				await this._languageModelsService.updateLanguageModelsProviderGroup(existing, trimmedName, vendorId, config);
			} else {
				await this._languageModelsService.addLanguageModelsProviderGroup(trimmedName, vendorId, config);
			}
			if (!this._isCurrentOperation(operation)) {
				return;
			}

			const savedGroup = this._configService.getLanguageModelsProviderGroups().find(group => group.vendor === vendorId && group.name === trimmedName);
			if (savedGroup) {
				const catalog = PROVIDER_CATALOG.find(provider => provider.vendor === vendorId);
				this._editingGroup = savedGroup;
				this._selectedEntry = {
					type: 'group',
					group: savedGroup,
					vendor: vendorId,
					displayName: trimmedName,
					icon: catalog?.icon ?? PROVIDER_ICONS[vendorId] ?? Codicon.server.id,
					status: 'inactive'
				};
			}
			this._clearDraftProviderState();
			if (!preflight.success) {
				this._setOperationError(localize('ps.save.preflightFailed', 'Provider saved, but the connection test failed: {0}', this._connectionErrorMessage(preflight)));
			} else if (preflight.models.length === 0) {
				this._setOperationError(localize('ps.save.noModels', 'Provider saved, but no models were discovered. Add a model ID manually if the endpoint does not expose a models list.'));
			}
		} catch (error) {
			if (this._isCurrentOperation(operation)) {
				this._setOperationError(error instanceof Error ? error.message : String(error));
			}
		} finally {
			this._finishOperation(operation);
		}
	}

	private _toCachedModel(model: ILanguageModelsProviderConnectionModel): Record<string, unknown> {
		const cached: Record<string, unknown> = { id: model.id, name: model.name };
		if (model.maxInputTokens !== undefined) { cached.maxInputTokens = model.maxInputTokens; }
		else if (model.tokens !== undefined) { cached.maxInputTokens = model.tokens; }
		if (model.maxOutputTokens !== undefined) { cached.maxOutputTokens = model.maxOutputTokens; }
		if (model.capabilities?.vision !== undefined) { cached.vision = model.capabilities.vision; }
		if (model.capabilities?.toolCalling !== undefined) { cached.toolCalling = model.capabilities.toolCalling; }
		if (model.capabilities?.agentMode !== undefined) { cached.agentMode = model.capabilities.agentMode; }
		if (model.capabilities?.editTools !== undefined) { cached.editTools = model.capabilities.editTools; }
		return cached;
	}

	private _connectionErrorMessage(result: ILanguageModelsProviderConnectionResult): string {
		return result.error ? this._classifyError(result.error) : result.errorCode ?? localize('ps.error.unknown', 'Unknown connection error');
	}

	private _collectDefaultModelValues(config: Record<string, unknown>, defaults: DefaultModelControls): void {
		config.defaultChatModel = defaults.defaultChatModel.value.replace(/^[^/]+\//, '');
		config.defaultCodingModel = defaults.defaultCodingModel.value.replace(/^[^/]+\//, '');
		config.fastModel = defaults.fastModel.value.replace(/^[^/]+\//, '');
		const manualModels = defaults.manualModels.value.split(',').map(model => model.trim()).filter(model => !!model);
		config.manualModels = manualModels;
		config.isDefaultProfile = defaults.isDefaultProfile.checked;
	}

	private _applyRecommendedDefaultModelValues(config: Record<string, unknown>, vendorId: string): void {
		const modelIds: string[] = [];
		const cachedModels = config.cachedModels;
		if (Array.isArray(cachedModels)) {
			for (const model of cachedModels) {
				if (model && typeof model === 'object' && typeof (model as Record<string, unknown>).id === 'string') {
					modelIds.push(`${vendorId}/${(model as Record<string, string>).id}`);
				}
			}
		}
		const manualModels = config.manualModels;
		if (Array.isArray(manualModels)) {
			for (const model of manualModels) {
				if (typeof model === 'string' && model.trim()) {
					modelIds.push(`${vendorId}/${model.trim()}`);
				}
			}
		}
		const recommended = this._recommendDefaultModels(vendorId, modelIds);
		if (!config.defaultChatModel && recommended.defaultChatModel) {
			config.defaultChatModel = recommended.defaultChatModel.replace(/^[^/]+\//, '');
		}
		if (!config.defaultCodingModel && recommended.defaultCodingModel) {
			config.defaultCodingModel = recommended.defaultCodingModel.replace(/^[^/]+\//, '');
		}
		if (!config.fastModel && recommended.fastModel) {
			config.fastModel = recommended.fastModel.replace(/^[^/]+\//, '');
		}
	}

	private async _duplicateGroup(group: ILanguageModelsProviderGroup): Promise<void> {
		const groups = this._configService.getLanguageModelsProviderGroups();
		let newName = `${group.name} (Copy)`;
		let count = 2;
		while (groups.some(g => g.vendor === group.vendor && g.name === newName)) {
			newName = `${group.name} (Copy ${count})`;
			count++;
		}

		const config: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(group)) {
			if (key === 'name' || key === 'vendor' || key === 'range' || key === 'settings') { continue; }
			config[key] = value;
		}

		const operation = this._beginOperation(false);
		if (operation === undefined) {
			return;
		}
		try {
			await this._languageModelsService.addLanguageModelsProviderGroup(newName, group.vendor, config);
		} catch (error) {
			if (this._isCurrentOperation(operation)) {
				this._setOperationError(error instanceof Error ? error.message : String(error));
			}
		} finally {
			this._finishOperation(operation);
		}
	}

	private async _removeGroup(group: ILanguageModelsProviderGroup): Promise<void> {
		const confirmation = await this._dialogService.confirm({
			type: Severity.Warning,
			message: localize('ps.remove.confirm', 'Remove provider "{0}"?', group.name),
			detail: localize('ps.remove.detail', 'This removes the provider profile and its stored credentials from Pointer.'),
			primaryButton: localize('ps.remove.button', 'Remove')
		});
		if (!confirmation.confirmed) {
			return;
		}
		const operation = this._beginOperation(false);
		if (operation === undefined) {
			return;
		}
		try {
			await this._languageModelsService.removeLanguageModelsProviderGroup(group.vendor, group.name);
			if (!this._isCurrentOperation(operation)) {
				return;
			}
			this._selectedEntry = undefined;
			this._editingGroup = undefined;
			this._clearDraftProviderState();
		} catch (error) {
			if (this._isCurrentOperation(operation)) {
				this._setOperationError(error instanceof Error ? error.message : String(error));
			}
		} finally {
			this._finishOperation(operation);
		}
	}
}

export class ProviderSetupEditor extends EditorPane {

	static readonly ID: string = 'workbench.editor.providerSetup';

	private _view: ProviderSetupView | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super(ProviderSetupEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this._view = this._register(this._instantiationService.createInstance(ProviderSetupView));
		this._view.render(parent);
	}

	override setVisible(visible: boolean): void {
		super.setVisible(visible);
		this._view?.setVisible(visible);
	}

	override layout(dimension: Dimension): void {
		this._view?.layout(dimension);
	}

	override focus(): void {
		super.focus();
		this._view?.focus();
	}
}
