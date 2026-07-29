/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType, getActiveWindow } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import product from '../../../../platform/product/common/product.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';
import { ILanguageModelsConfigurationService } from '../../chat/common/languageModelsConfiguration.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { IOnboardingService } from '../common/onboardingService.js';
import {
	getOnboardingStepSubtitle,
	getOnboardingStepTitle,
	IOnboardingThemeOption,
	OnboardingStepId,
	ONBOARDING_STEPS,
	POINTER_ONBOARDING_THEMES,
	TOP_OLLAMA_MODELS,
} from '../common/onboardingTypes.js';

type OnboardingStepViewClassification = {
	owner: 'cwebster-99';
	comment: 'Tracks which Pointer onboarding step is viewed.';
	step: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The step identifier.' };
	stepNumber: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The 1-based step index.' };
};

type OnboardingStepViewEvent = {
	step: string;
	stepNumber: number;
};

type OnboardingActionClassification = {
	owner: 'cwebster-99';
	comment: 'Tracks actions taken in Pointer onboarding.';
	action: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The action performed.' };
	step: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The active step.' };
	argument: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Optional non-user context.' };
};

type OnboardingActionEvent = {
	action: string;
	step: string;
	argument: string | undefined;
};

type LocalProviderId = 'ollama' | 'lmstudio';

interface ILocalProviderDefinition {
	readonly id: LocalProviderId;
	readonly name: string;
	readonly endpoint: string;
	readonly modelsUrl: string;
	readonly icon: typeof Codicon.serverEnvironment;
}

interface IDetectedLocalProvider {
	readonly definition: ILocalProviderDefinition;
	readonly available: boolean;
	readonly models: readonly string[];
	selected: boolean;
}

interface IOllamaTagsResponse {
	readonly models?: readonly { readonly name?: string; readonly model?: string }[];
}

interface IOpenAIModelsResponse {
	readonly data?: readonly { readonly id?: string }[];
}

type ModelRole = 'agent' | 'completion';

interface IModelCatalogEntry {
	readonly id: string;
	readonly name: string;
	readonly providerId: string;
	readonly providerName: string;
	readonly category: ModelRole;
	readonly parameterSize: string;
	readonly description: string;
	readonly installed: boolean;
	readonly downloadable: boolean;
	readonly contextWindow?: number;
	readonly supportsTools?: boolean;
}

const LOCAL_PROVIDER_DEFINITIONS: readonly ILocalProviderDefinition[] = [
	{
		id: 'ollama',
		name: 'Ollama',
		endpoint: 'http://127.0.0.1:11434',
		modelsUrl: 'http://127.0.0.1:11434/api/tags',
		icon: Codicon.serverEnvironment,
	},
	{
		id: 'lmstudio',
		name: 'LM Studio',
		endpoint: 'http://127.0.0.1:1234',
		modelsUrl: 'http://127.0.0.1:1234/v1/models',
		icon: Codicon.chip,
	},
];

/**
 * Pointer's first-launch setup: High-end theme selection, hardware-shaped local models,
 * 1-click model downloading & configuration for Sidebar Agent + Tab Completion.
 */
export class OnboardingVariationA extends Disposable implements IOnboardingService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidDismiss = this._register(new Emitter<void>());
	readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

	private overlay: HTMLElement | undefined;
	private card: HTMLElement | undefined;
	private progressContainer: HTMLElement | undefined;
	private bodyElement: HTMLElement | undefined;
	private titleElement: HTMLElement | undefined;
	private subtitleElement: HTMLElement | undefined;
	private contentElement: HTMLElement | undefined;
	private backButton: HTMLButtonElement | undefined;
	private nextButton: HTMLButtonElement | undefined;

	private readonly steps = ONBOARDING_STEPS;
	private readonly viewDisposables = this._register(new DisposableStore());
	private readonly stepDisposables = this._register(new DisposableStore());
	private readonly stepFocusableElements: HTMLElement[] = [];
	private readonly footerFocusableElements: HTMLElement[] = [];
	private currentStepIndex = 0;
	private selectedThemeId = 'pointer-dark';
	private detectedProviders: readonly IDetectedLocalProvider[] = [];
	private configuredProviderIds = new Set<LocalProviderId>();
	private scanGeneration = 0;
	private isScanning = false;
	private isConfiguring = false;
	private isShowing = false;
	private previouslyFocusedElement: HTMLElement | undefined;

	private selectedAgentModel = 'qwen2.5-coder:7b';
	private selectedCompletionModel = 'qwen2.5-coder:1.5b-base';
	private selectedAgentProviderId = 'ollama';
	private selectedCompletionProviderId = 'ollama';
	private customHuggingFaceModel = '';
	private downloadingModels = new Map<string, { status: string; progress: number }>();
	private stepDirection: 'forward' | 'backward' | undefined;
	private readonly downloadProgressElements = new Map<string, { readonly fill: HTMLElement; readonly text: HTMLElement; readonly box: HTMLElement }>();

	constructor(
		@ILayoutService private readonly layoutService: ILayoutService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IRequestService private readonly requestService: IRequestService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@ILanguageModelsConfigurationService private readonly languageModelsConfigurationService: ILanguageModelsConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ICommandService private readonly commandService: ICommandService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
	) {
		super();

		const currentThemeId = this.themeService.getColorTheme().settingsId;
		const currentTheme = POINTER_ONBOARDING_THEMES.find(theme => theme.themeId === currentThemeId);
		if (currentTheme) {
			this.selectedThemeId = currentTheme.id;
		}

		void this.scanLocalProviders();
	}

	show(): void {
		if (this.overlay) {
			this.focusCurrentStepElement();
			return;
		}

		this.isShowing = true;
		this.previouslyFocusedElement = getActiveWindow().document.activeElement as HTMLElement | undefined;

		this.overlay = append(this.layoutService.activeContainer, $('.onboarding-a-overlay'));
		this.overlay.setAttribute('role', 'dialog');
		this.overlay.setAttribute('aria-modal', 'true');
		this.overlay.setAttribute('aria-label', localize('onboarding.aria', "Set up Pointer"));

		this.card = append(this.overlay, $('.onboarding-a-card.onboarding-a-card-intro'));
		const launchMark = append(this.card, $('span.onboarding-a-launch-mark'));
		launchMark.setAttribute('aria-hidden', 'true');

		const header = append(this.card, $('.onboarding-a-header'));
		const brand = append(header, $('.onboarding-a-brand'));
		const brandMark = append(brand, $('span.onboarding-a-brand-mark'));
		brandMark.setAttribute('aria-hidden', 'true');
		const brandName = append(brand, $('span.onboarding-a-brand-name'));
		brandName.textContent = product.nameShort;

		this.progressContainer = append(header, $('.onboarding-a-progress'));
		this.progressContainer.setAttribute('role', 'progressbar');
		this.progressContainer.setAttribute('aria-valuemin', '1');
		this.progressContainer.setAttribute('aria-valuemax', String(this.steps.length));

		const body = this.bodyElement = append(this.card, $('.onboarding-a-body'));
		this.titleElement = append(body, $('h1.onboarding-a-step-title'));
		this.subtitleElement = append(body, $('p.onboarding-a-step-subtitle'));
		this.contentElement = append(body, $('.onboarding-a-step-content'));

		const footer = append(this.card, $('.onboarding-a-footer'));
		const footerActions = append(footer, $('.onboarding-a-footer-actions'));
		this.backButton = append(footerActions, $<HTMLButtonElement>('button.onboarding-a-btn.onboarding-a-btn-secondary'));
		this.backButton.type = 'button';
		this.backButton.textContent = localize('onboarding.back', "Back");
		this.nextButton = append(footerActions, $<HTMLButtonElement>('button.onboarding-a-btn.onboarding-a-btn-primary'));
		this.nextButton.type = 'button';
		this.footerFocusableElements.push(this.backButton, this.nextButton);

		this.viewDisposables.add(addDisposableListener(this.backButton, EventType.CLICK, () => this.previousStep()));
		this.viewDisposables.add(addDisposableListener(this.nextButton, EventType.CLICK, async () => {
			if (this.isConfiguring) {
				return;
			}

			if (this.isLastStep()) {
				this.logAction('complete');
				this.dismiss();
				return;
			}

			if (this.steps[this.currentStepIndex] === OnboardingStepId.CompletionModel) {
				await this.configureSelectedProviders();
			}

			this.nextStep();
		}));
		this.viewDisposables.add(addDisposableListener(this.overlay, EventType.KEY_DOWN, event => {
			const keyboardEvent = new StandardKeyboardEvent(event);
			event.stopPropagation();
			if (keyboardEvent.keyCode === KeyCode.Tab) {
				this.trapTab(event, keyboardEvent.shiftKey);
			}
		}));
		this.viewDisposables.add(addDisposableListener(body, EventType.MOUSE_WHEEL, (event: WheelEvent) => {
			if (body.scrollHeight <= body.clientHeight || event.deltaY === 0) {
				return;
			}
			const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
				? 16
				: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
					? body.clientHeight
					: 1;
			body.scrollTop += event.deltaY * multiplier;
			event.preventDefault();
			event.stopPropagation();
		}, { passive: false }));

		this.renderCurrentStep();
		this.overlay.classList.add('entering');
		getActiveWindow().requestAnimationFrame(() => {
			this.overlay?.classList.add('visible');
			getActiveWindow().setTimeout(() => {
				this.overlay?.classList.remove('entering');
				this.card?.classList.remove('onboarding-a-card-intro');
				this.card?.classList.add('onboarding-a-card-ready');
			}, 420);
		});
		this.focusCurrentStepElement();
	}

	private dismiss(): void {
		if (!this.overlay) {
			return;
		}

		this.overlay.classList.remove('visible');
		this.overlay.classList.add('exiting');
		let removed = false;
		const finish = () => {
			if (removed) {
				return;
			}
			removed = true;
			this.removeFromDom();
			this._onDidDismiss.fire();
		};
		this.overlay.addEventListener('transitionend', finish, { once: true });
		getActiveWindow().setTimeout(finish, 240);
	}

	private nextStep(): void {
		if (this.currentStepIndex >= this.steps.length - 1) {
			return;
		}
		this.currentStepIndex++;
		this.stepDirection = 'forward';
		this.logAction('next');
		this.renderCurrentStep();
		this.focusCurrentStepElement();
	}

	private previousStep(): void {
		if (this.currentStepIndex === 0) {
			return;
		}
		this.currentStepIndex--;
		this.stepDirection = 'backward';
		this.logAction('back');
		this.renderCurrentStep();
		this.focusCurrentStepElement();
	}

	private isLastStep(): boolean {
		return this.currentStepIndex === this.steps.length - 1;
	}

	private renderCurrentStep(): void {
		if (!this.progressContainer || !this.titleElement || !this.subtitleElement || !this.contentElement) {
			return;
		}

		this.stepDisposables.clear();
		this.stepFocusableElements.length = 0;
		this.downloadProgressElements.clear();
		clearNode(this.progressContainer);
		clearNode(this.contentElement);

		const currentStepNumber = this.currentStepIndex + 1;
		this.progressContainer.setAttribute('aria-valuenow', String(currentStepNumber));
		this.progressContainer.setAttribute('aria-valuetext', localize('onboarding.progressAria', "Step {0} of {1}", currentStepNumber, this.steps.length));
		const progressLabel = append(this.progressContainer, $('span.onboarding-a-progress-label'));
		progressLabel.textContent = localize('onboarding.progress', "{0} / {1}", currentStepNumber, this.steps.length);
		const progressTrack = append(this.progressContainer, $('span.onboarding-a-progress-track'));
		const progressValue = append(progressTrack, $('span.onboarding-a-progress-value'));
		progressValue.style.width = `${(currentStepNumber / this.steps.length) * 100}%`;

		const step = this.steps[this.currentStepIndex];
		this.titleElement.textContent = getOnboardingStepTitle(step);
		this.subtitleElement.textContent = getOnboardingStepSubtitle(step);
		this.contentElement.setAttribute('aria-live', step === OnboardingStepId.AgentModel || step === OnboardingStepId.CompletionModel ? 'polite' : 'off');
		this.bodyElement?.classList.remove('onboarding-a-step-forward', 'onboarding-a-step-backward');
		if (this.bodyElement && this.stepDirection) {
			void this.bodyElement.offsetWidth;
			this.bodyElement.classList.add(this.stepDirection === 'forward' ? 'onboarding-a-step-forward' : 'onboarding-a-step-backward');
			this.stepDirection = undefined;
		}

		switch (step) {
			case OnboardingStepId.Theme:
				this.renderThemeStep(this.contentElement);
				break;
			case OnboardingStepId.Runtime:
				this.renderLocalModelsStep(this.contentElement);
				break;
			case OnboardingStepId.AgentModel:
				this.renderModelSelectionStep(this.contentElement, 'agent');
				break;
			case OnboardingStepId.CompletionModel:
				this.renderModelSelectionStep(this.contentElement, 'completion');
				break;
			case OnboardingStepId.Ready:
				this.renderReadyStep(this.contentElement);
				break;
		}

		if (this.backButton) {
			this.backButton.style.display = this.currentStepIndex === 0 ? 'none' : '';
		}
		if (this.nextButton) {
			this.nextButton.textContent = this.isLastStep()
				? localize('onboarding.start', "Start using Pointer")
				: localize('onboarding.continue', "Continue");
			this.nextButton.disabled = false;
		}

		this.telemetryService.publicLog2<OnboardingStepViewEvent, OnboardingStepViewClassification>('welcomeOnboarding.stepView', {
			step,
			stepNumber: this.currentStepIndex + 1,
		});
	}

	private renderThemeStep(container: HTMLElement): void {
		const themeGrid = append(container, $('.onboarding-a-theme-grid'));
		themeGrid.setAttribute('role', 'radiogroup');
		themeGrid.setAttribute('aria-label', localize('onboarding.theme.label', "Choose a Pointer theme"));

		const cards: HTMLButtonElement[] = [];
		for (const theme of POINTER_ONBOARDING_THEMES) {
			const card = this.registerStepFocusable(append(themeGrid, $<HTMLButtonElement>('button.onboarding-a-theme-card')));
			cards.push(card);
			card.type = 'button';
			card.dataset.theme = theme.id;
			card.classList.add(theme.type === 'light' ? 'light' : 'dark');
			card.classList.add(theme.id);
			card.classList.toggle('selected', theme.id === this.selectedThemeId);
			card.setAttribute('role', 'radio');
			card.setAttribute('aria-checked', theme.id === this.selectedThemeId ? 'true' : 'false');

			const preview = append(card, $('.onboarding-a-theme-preview'));
			const previewRail = append(preview, $('.onboarding-a-theme-preview-rail'));
			append(previewRail, $('span'));
			append(previewRail, $('span'));
			append(previewRail, $('span'));
			const previewEditor = append(preview, $('.onboarding-a-theme-preview-editor'));
			append(previewEditor, $('span.long'));
			append(previewEditor, $('span.medium'));
			append(previewEditor, $('span.short'));
			const label = append(card, $('.onboarding-a-theme-label'));
			label.textContent = theme.label;
			const description = append(card, $('.onboarding-a-theme-description'));
			description.textContent = theme.id === 'pointer-obsidian'
				? localize('onboarding.theme.obsidian.desc', "Deep black with restrained contrast")
				: theme.id === 'pointer-cyber'
					? localize('onboarding.theme.cyber.desc', "Dark with brighter accents")
					: theme.type === 'light'
						? localize('onboarding.theme.light.description', "Light editor and dark text")
						: localize('onboarding.theme.dark.description', "Dark editor and clear text");

			this.stepDisposables.add(addDisposableListener(card, EventType.CLICK, () => {
				for (const candidate of cards) {
					const selected = candidate === card;
					candidate.classList.toggle('selected', selected);
					candidate.setAttribute('aria-checked', selected ? 'true' : 'false');
				}
				void this.selectTheme(theme);
			}));
		}

		this.setupRadioGroupNavigation(cards, Math.max(0, POINTER_ONBOARDING_THEMES.findIndex(theme => theme.id === this.selectedThemeId)));
	}

	private async selectTheme(theme: IOnboardingThemeOption): Promise<void> {
		this.selectedThemeId = theme.id;
		this.logAction('selectTheme', theme.id);
		const themes = await this.themeService.getColorThemes();
		const match = themes.find(candidate => candidate.settingsId === theme.themeId);
		if (match) {
			await this.themeService.setColorTheme(match.id, ConfigurationTarget.USER);
			this.accessibilityService.alert(localize('onboarding.theme.selected', "{0} selected", theme.label));
		}
	}

	private renderLocalModelsStep(container: HTMLElement): void {
		const ollamaProvider = this.detectedProviders.find(p => p.definition.id === 'ollama');
		const ollamaActive = ollamaProvider?.available ?? false;
		const installedModels = new Set(ollamaProvider?.models ?? []);

		const toolbar = append(container, $('.onboarding-a-model-toolbar'));
		const scanStatus = append(toolbar, $('.onboarding-a-scan-status'));
		const scanIcon = append(scanStatus, $('span.onboarding-a-scan-icon'));
		scanIcon.appendChild(renderIcon(this.isScanning ? Codicon.loading : (ollamaActive ? Codicon.check : Codicon.warning)));
		if (this.isScanning) {
			scanIcon.classList.add('spinning');
		}
		const scanText = append(scanStatus, $('span'));
		scanText.textContent = this.isScanning
			? localize('onboarding.models.scanning', "Scanning local AI daemons…")
			: ollamaActive
				? localize('onboarding.models.ollamaReady', "Ollama is running · {0} models installed", installedModels.size)
				: localize('onboarding.models.ollamaOffline', "Ollama isn't running. Install it or scan again.");

		const actionsGroup = append(toolbar, $('.onboarding-a-toolbar-actions'));

		if (!ollamaActive) {
			const downloadOllamaBtn = this.registerStepFocusable(append(actionsGroup, $<HTMLButtonElement>('button.onboarding-a-btn-accent')));
			downloadOllamaBtn.type = 'button';
			downloadOllamaBtn.appendChild(renderIcon(Codicon.cloudDownload));
			downloadOllamaBtn.append(' Get Ollama');
			this.stepDisposables.add(addDisposableListener(downloadOllamaBtn, EventType.CLICK, () => {
				getActiveWindow().open('https://ollama.com/download', '_blank');
			}));
		}

		const refreshButton = this.registerStepFocusable(append(actionsGroup, $<HTMLButtonElement>('button.onboarding-a-refresh-btn')));
		refreshButton.type = 'button';
		refreshButton.disabled = this.isScanning;
		refreshButton.appendChild(renderIcon(Codicon.refresh));
		refreshButton.append(localize('onboarding.models.scanAgain', "Scan again"));
		this.stepDisposables.add(addDisposableListener(refreshButton, EventType.CLICK, () => void this.scanLocalProviders(true)));

		const intro = append(container, $('.onboarding-a-step-callout'));
		const introIcon = append(intro, $('span.onboarding-a-step-callout-icon'));
		introIcon.appendChild(renderIcon(Codicon.serverEnvironment));
		const introCopy = append(intro, $('.onboarding-a-step-callout-copy'));
		append(introCopy, $('strong')).textContent = localize('onboarding.models.runtimeTitle', "Choose your local runtime");
		append(introCopy, $('span')).textContent = localize('onboarding.models.runtimeCopy', "Pointer connects directly to runtimes on this computer. Nothing is sent to GitHub.");
		this.renderProvidersList(container);
		const privacyNote = append(container, $('.onboarding-a-model-note'));
		privacyNote.appendChild(renderIcon(Codicon.shield));
		privacyNote.append(localize('onboarding.models.runtimeNote', "Your local prompts and model traffic stay on this device."));
	}

	/** @deprecated Kept for extension-host compatibility with older onboarding overrides. */
	renderModelHub(container: HTMLElement, installedModels: Set<string>, ollamaActive: boolean): void {
		const hubContainer = append(container, $('.onboarding-a-hub-container'));

		const grid = append(hubContainer, $('.onboarding-a-catalog-grid'));

		for (const model of TOP_OLLAMA_MODELS) {
			const isInstalled = installedModels.has(model.id) || installedModels.has(`${model.id}:latest`);
			const downloadState = this.downloadingModels.get(model.id);
			const isSelectedAgent = this.selectedAgentModel === model.id;
			const isSelectedCompletion = this.selectedCompletionModel === model.id;

			const card = append(grid, $('.onboarding-a-catalog-card'));
			card.classList.toggle('active-agent', isSelectedAgent);
			card.classList.toggle('active-completion', isSelectedCompletion);

			const cardHeader = append(card, $('.onboarding-a-card-header'));
			const titleBox = append(cardHeader, $('.onboarding-a-card-title-box'));
			const title = append(titleBox, $('span.title'));
			title.textContent = model.name;

			const badges = append(cardHeader, $('.onboarding-a-card-badges'));
			const categoryBadge = append(badges, $(`span.badge.badge-${model.category}`));
			categoryBadge.textContent = model.category === 'agent' ? 'Agent' : 'Completion';

			const sizeBadge = append(badges, $('span.badge.badge-size'));
			sizeBadge.textContent = model.parameterSize;

			const desc = append(card, $('p.onboarding-a-card-desc'));
			desc.textContent = model.description;

			const actions = append(card, $('.onboarding-a-card-actions'));

			if (downloadState) {
				const progressBox = append(actions, $('.onboarding-a-progress-box'));
				progressBox.setAttribute('role', 'progressbar');
				progressBox.setAttribute('aria-valuemin', '0');
				progressBox.setAttribute('aria-valuemax', '100');
				progressBox.setAttribute('aria-valuenow', String(downloadState.progress));
				const progressBar = append(progressBox, $('.onboarding-a-progress-fill'));
				progressBar.style.width = `${downloadState.progress}%`;
				const progressText = append(progressBox, $('span.progress-text'));
				progressText.textContent = downloadState.status;
				this.downloadProgressElements.set(model.id, { fill: progressBar, text: progressText, box: progressBox });
			} else if (isInstalled) {
				const statusBadge = append(actions, $('span.onboarding-a-installed-badge'));
				statusBadge.appendChild(renderIcon(Codicon.check));
				statusBadge.append(' Installed');

				const roleGroup = append(actions, $('.onboarding-a-role-group'));

				if (model.category === 'agent') {
					const agentBtn = this.registerStepFocusable(append(roleGroup, $<HTMLButtonElement>('button.onboarding-a-role-btn')));
					agentBtn.type = 'button';
					agentBtn.classList.toggle('selected', isSelectedAgent);
					agentBtn.textContent = isSelectedAgent ? '✓ Sidebar Agent' : 'Set as Agent';
					this.stepDisposables.add(addDisposableListener(agentBtn, EventType.CLICK, () => {
						this.selectedAgentModel = model.id;
						this.renderCurrentStep();
					}));
				} else {
					const compBtn = this.registerStepFocusable(append(roleGroup, $<HTMLButtonElement>('button.onboarding-a-role-btn')));
					compBtn.type = 'button';
					compBtn.classList.toggle('selected', isSelectedCompletion);
					compBtn.textContent = isSelectedCompletion ? '✓ Tab Completion' : 'Set for Completion';
					this.stepDisposables.add(addDisposableListener(compBtn, EventType.CLICK, () => {
						this.selectedCompletionModel = model.id;
						this.renderCurrentStep();
					}));
				}
			} else {
				const pullBtn = this.registerStepFocusable(append(actions, $<HTMLButtonElement>('button.onboarding-a-pull-btn')));
				pullBtn.type = 'button';
				pullBtn.disabled = !ollamaActive;
				pullBtn.appendChild(renderIcon(Codicon.cloudDownload));
				pullBtn.append(ollamaActive ? ` ${localize('onboarding.models.download', "Download")}` : ` ${localize('onboarding.models.offline', "Offline")}`);

				this.stepDisposables.add(addDisposableListener(pullBtn, EventType.CLICK, () => {
					void this.pullOllamaModel(model.id);
				}));
			}
		}
	}

	private renderModelSelectionStep(container: HTMLElement, role: ModelRole): void {
		const ollamaActive = this.detectedProviders.find(provider => provider.definition.id === 'ollama')?.available ?? false;
		const catalog = this.getModelCatalog().sort((left, right) => {
			const availability = Number(right.installed) - Number(left.installed);
			if (availability !== 0) {
				return availability;
			}
			const roleFit = Number(right.category === role) - Number(left.category === role);
			return roleFit !== 0 ? roleFit : left.name.localeCompare(right.name);
		});
		const availableCount = catalog.filter(model => model.installed).length;
		const providerCount = new Set(catalog.filter(model => model.installed).map(model => model.providerId)).size;
		const overview = append(container, $('.onboarding-a-model-overview'));
		const overviewIcon = append(overview, $('span.onboarding-a-model-overview-icon'));
		overviewIcon.appendChild(renderIcon(role === 'agent' ? Codicon.robot : Codicon.zap));
		append(overview, $('span')).textContent = localize(
			'onboarding.models.availableSummary',
			"{0} available models from {1} connected sources. You can change this later.",
			availableCount,
			providerCount,
		);

		const customDetails = append(container, $<HTMLDetailsElement>('details.onboarding-a-custom-model-details'));
		const customSummary = this.registerStepFocusable(append(customDetails, $<HTMLElement>('summary.onboarding-a-custom-model-summary')));
		customSummary.appendChild(renderIcon(Codicon.repo));
		customSummary.append(` ${localize('onboarding.models.addHuggingFace', "Add a Hugging Face model")}`);
		const custom = append(customDetails, $('.onboarding-a-custom-model'));
		const customIcon = append(custom, $('span.onboarding-a-custom-model-icon'));
		customIcon.appendChild(renderIcon(Codicon.repo));
		const customInput = this.registerStepFocusable(append(custom, $<HTMLInputElement>('input.onboarding-a-custom-model-input')));
		customInput.type = 'text';
		customInput.placeholder = 'hf.co/owner/model:tag';
		customInput.value = this.customHuggingFaceModel;
		customInput.setAttribute('aria-label', localize('onboarding.models.huggingFaceInput', "Hugging Face model reference"));
		const customButton = this.registerStepFocusable(append(custom, $<HTMLButtonElement>('button.onboarding-a-pull-btn')));
		customButton.type = 'button';
		customButton.appendChild(renderIcon(Codicon.cloudDownload));
		customButton.append(` ${localize('onboarding.models.pull', "Pull model")}`);
		const updateCustomButton = () => customButton.disabled = !ollamaActive || !this.isValidHuggingFaceModel(customInput.value);
		updateCustomButton();
		this.stepDisposables.add(addDisposableListener(customInput, EventType.INPUT, () => {
			this.customHuggingFaceModel = customInput.value.trim();
			updateCustomButton();
		}));
		this.stepDisposables.add(addDisposableListener(customButton, EventType.CLICK, () => {
			const modelId = customInput.value.trim();
			if (this.isValidHuggingFaceModel(modelId)) {
				void this.pullOllamaModel(modelId, role);
			}
		}));

		const grid = append(container, $('.onboarding-a-catalog-grid'));
		grid.setAttribute('role', 'list');
		for (const model of catalog) {
			this.renderRoleModelCard(grid, model, role, ollamaActive);
		}
	}

	private renderRoleModelCard(grid: HTMLElement, model: IModelCatalogEntry, role: ModelRole, ollamaActive: boolean): void {
		const downloadState = this.downloadingModels.get(model.id);
		const selected = role === 'agent'
			? this.selectedAgentModel === model.id && this.selectedAgentProviderId === model.providerId
			: this.selectedCompletionModel === model.id && this.selectedCompletionProviderId === model.providerId;
		const card = append(grid, $('.onboarding-a-catalog-card'));
		card.setAttribute('role', 'listitem');
		card.classList.toggle(`active-${role}`, selected);
		const header = append(card, $('.onboarding-a-card-header'));
		const titleBox = append(header, $('.onboarding-a-card-title-box'));
		append(titleBox, $('span.title')).textContent = model.name;
		const metadata = append(header, $('.onboarding-a-card-metadata'));
		metadata.textContent = [model.providerName, model.parameterSize, model.contextWindow ? `${this.formatCompactNumber(model.contextWindow)} context` : undefined].filter(Boolean).join(' · ');
		if (model.category === role) {
			const fit = append(header, $('span.onboarding-a-model-fit'));
			fit.textContent = role === 'agent'
				? localize('onboarding.models.agentFit', "Agent fit")
				: localize('onboarding.models.completionFit', "Completion fit");
		}
		append(card, $('p.onboarding-a-card-desc')).textContent = model.description;
		const actions = append(card, $('.onboarding-a-card-actions'));
		if (downloadState) {
			const box = append(actions, $('.onboarding-a-progress-box'));
			box.setAttribute('role', 'progressbar');
			box.setAttribute('aria-valuemin', '0');
			box.setAttribute('aria-valuemax', '100');
			box.setAttribute('aria-valuenow', String(downloadState.progress));
			const fill = append(box, $('.onboarding-a-progress-fill'));
			fill.style.width = `${downloadState.progress}%`;
			const text = append(box, $('span.progress-text'));
			text.textContent = downloadState.status;
			this.downloadProgressElements.set(model.id, { fill, text, box });
			return;
		}
		if (!model.installed && model.downloadable) {
			const pull = this.registerStepFocusable(append(actions, $<HTMLButtonElement>('button.onboarding-a-pull-btn')));
			pull.type = 'button';
			pull.disabled = !ollamaActive || model.providerId !== 'ollama';
			pull.appendChild(renderIcon(Codicon.cloudDownload));
			pull.append(` ${ollamaActive ? localize('onboarding.models.download', "Download") : localize('onboarding.models.offline', "Offline")}`);
			this.stepDisposables.add(addDisposableListener(pull, EventType.CLICK, () => void this.pullOllamaModel(model.id, role)));
			return;
		}
		if (!model.installed) {
			const unavailable = append(actions, $('span.onboarding-a-installed-badge'));
			unavailable.appendChild(renderIcon(Codicon.circleSlash));
			unavailable.append(` ${localize('onboarding.models.configureSource', "Configure source first")}`);
			return;
		}
		const source = append(actions, $('span.onboarding-a-installed-badge'));
		source.appendChild(renderIcon(model.providerId === 'ollama' || model.providerId === 'lmstudio' ? Codicon.deviceDesktop : Codicon.cloud));
		source.append(` ${model.providerId === 'ollama' || model.providerId === 'lmstudio' ? localize('onboarding.models.onDevice', "On device") : localize('onboarding.models.connected', "Connected")}`);
		const roleButton = this.registerStepFocusable(append(actions, $<HTMLButtonElement>('button.onboarding-a-role-btn')));
		roleButton.type = 'button';
		roleButton.classList.toggle('selected', selected);
		roleButton.setAttribute('aria-pressed', String(selected));
		if (selected) {
			roleButton.appendChild(renderIcon(Codicon.check));
		}
		roleButton.append(selected
			? localize('onboarding.models.selected', " Selected")
			: (role === 'agent' ? 'Use for Agent' : 'Use for Completion'));
		this.stepDisposables.add(addDisposableListener(roleButton, EventType.CLICK, () => this.selectModel(model, role)));
	}

	private getModelCatalog(): IModelCatalogEntry[] {
		const catalog = new Map<string, IModelCatalogEntry>();
		const ollamaModels = new Set(this.detectedProviders.find(provider => provider.definition.id === 'ollama')?.models ?? []);
		for (const model of TOP_OLLAMA_MODELS) {
			catalog.set(`ollama:${model.id}`, { ...model, providerId: 'ollama', providerName: 'Ollama', installed: ollamaModels.has(model.id) || ollamaModels.has(`${model.id}:latest`), downloadable: true });
		}
		for (const provider of this.detectedProviders.filter(candidate => candidate.available)) {
			for (const modelId of provider.models) {
				const key = `${provider.definition.id}:${modelId}`;
				if (!catalog.has(key)) {
					catalog.set(key, {
						id: modelId,
						name: modelId,
						providerId: provider.definition.id,
						providerName: provider.definition.name,
						category: this.guessModelRole(modelId),
						parameterSize: this.guessParameterSize(modelId),
						description: localize('onboarding.models.localModel', "Installed through {0}", provider.definition.name),
						installed: true,
						downloadable: false,
					});
				}
			}
		}

		for (const identifier of this.languageModelsService.getLanguageModelIds()) {
			const metadata = this.languageModelsService.lookupLanguageModel(identifier);
			if (!metadata || metadata.isUserSelectable === false) {
				continue;
			}
			const providerName = metadata.auth?.providerLabel ?? metadata.detail ?? this.formatProviderName(metadata.vendor);
			const source = metadata.auth?.accountLabel
				? localize('onboarding.models.connectedAccount', "Connected as {0}", metadata.auth.accountLabel)
				: localize('onboarding.models.registeredSource', "Available from {0}", providerName);
			catalog.set(`${metadata.vendor}:${metadata.id}`, {
				id: metadata.id,
				name: metadata.name,
				providerId: metadata.vendor,
				providerName,
				category: metadata.capabilities?.toolCalling === false ? 'completion' : this.guessModelRole(metadata.id),
				parameterSize: this.guessParameterSize(metadata.id),
				description: source,
				installed: true,
				downloadable: false,
				contextWindow: metadata.maxInputTokens,
				supportsTools: metadata.capabilities?.toolCalling,
			});
		}

		for (const group of this.languageModelsConfigurationService.getLanguageModelsProviderGroups()) {
			if (group.enabled === false) {
				continue;
			}
			const configuredModels = this.getConfiguredModelEntries(group.cachedModels);
			for (const configured of configuredModels) {
				const key = `${group.vendor}:${configured.id}`;
				if (catalog.has(key)) {
					continue;
				}
				catalog.set(key, {
					id: configured.id,
					name: configured.name,
					providerId: group.vendor,
					providerName: group.name,
					category: configured.toolCalling === false ? 'completion' : this.guessModelRole(configured.id),
					parameterSize: this.guessParameterSize(configured.id),
					description: localize('onboarding.models.configuredSource', "Configured in {0}", group.name),
					installed: true,
					downloadable: false,
					contextWindow: configured.maxInputTokens,
					supportsTools: configured.toolCalling,
				});
			}
		}
		return [...catalog.values()];
	}

	private getConfiguredModelEntries(value: unknown): Array<{ id: string; name: string; maxInputTokens?: number; toolCalling?: boolean }> {
		if (!Array.isArray(value)) {
			return [];
		}
		return value.flatMap(entry => {
			if (typeof entry === 'string' && entry.trim()) {
				return [{ id: entry.trim(), name: entry.trim() }];
			}
			if (!entry || typeof entry !== 'object') {
				return [];
			}
			const candidate = entry as Record<string, unknown>;
			if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
				return [];
			}
			return [{
				id: candidate.id.trim(),
				name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : candidate.id.trim(),
				maxInputTokens: typeof candidate.maxInputTokens === 'number' ? candidate.maxInputTokens : undefined,
				toolCalling: typeof candidate.toolCalling === 'boolean' ? candidate.toolCalling : undefined,
			}];
		});
	}

	private formatProviderName(providerId: string): string {
		return providerId.split(/[-_]/g).filter(Boolean).map(part => part[0]?.toUpperCase() + part.slice(1)).join(' ');
	}

	private formatCompactNumber(value: number): string {
		return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}K` : String(value);
	}

	private selectModel(model: IModelCatalogEntry, role: ModelRole): void {
		if (role === 'agent') {
			this.selectedAgentModel = model.id;
			this.selectedAgentProviderId = model.providerId;
		} else {
			this.selectedCompletionModel = model.id;
			this.selectedCompletionProviderId = model.providerId;
		}
		this.logAction(role === 'agent' ? 'selectAgentModel' : 'selectCompletionModel', `${model.providerId}:${model.id}`);
		this.renderCurrentStep();
	}

	private guessModelRole(modelId: string): ModelRole {
		return /(?:fim|starcoder|completion|autocomplete|base)/i.test(modelId) ? 'completion' : 'agent';
	}

	private guessParameterSize(modelId: string): string {
		return modelId.match(/\b\d+(?:\.\d+)?b\b/i)?.[0].toUpperCase() ?? localize('onboarding.models.local', "Local");
	}

	private isValidHuggingFaceModel(value: string): boolean {
		return /^(?:hf\.co\/)?[\w.-]+\/[\w.-]+(?::[\w.-]+)?$/i.test(value.trim());
	}

	private renderProvidersList(container: HTMLElement): void {
		const providerList = append(container, $('.onboarding-a-provider-list'));
		const providers = this.detectedProviders.length > 0
			? this.detectedProviders
			: LOCAL_PROVIDER_DEFINITIONS.map(definition => ({ definition, available: false, models: [], selected: false }));

		for (const provider of providers) {
			const card = this.registerStepFocusable(append(providerList, $<HTMLButtonElement>('button.onboarding-a-provider-card')));
			card.type = 'button';
			card.disabled = this.isScanning || !provider.available;
			card.classList.toggle('available', provider.available);
			card.classList.toggle('selected', provider.selected);
			card.setAttribute('aria-pressed', provider.selected ? 'true' : 'false');

			const icon = append(card, $('.onboarding-a-provider-icon'));
			icon.appendChild(renderIcon(provider.definition.icon));
			const details = append(card, $('.onboarding-a-provider-details'));
			const titleRow = append(details, $('.onboarding-a-provider-title-row'));
			const title = append(titleRow, $('span.onboarding-a-provider-title'));
			title.textContent = provider.definition.name;
			const state = append(titleRow, $('span.onboarding-a-provider-state'));
			state.textContent = this.isScanning
				? localize('onboarding.models.checking', "Checking")
				: provider.available
					? localize('onboarding.models.detected', "Detected")
					: localize('onboarding.models.notRunning', "Not running");
			const endpoint = append(details, $('span.onboarding-a-provider-endpoint'));
			endpoint.textContent = provider.definition.endpoint;

			if (provider.models.length > 0) {
				const models = append(details, $('.onboarding-a-model-chips'));
				for (const model of provider.models.slice(0, 5)) {
					const chip = append(models, $('span.onboarding-a-model-chip'));
					chip.textContent = model;
				}
				if (provider.models.length > 5) {
					const more = append(models, $('span.onboarding-a-model-chip.more'));
					more.textContent = localize('onboarding.models.more', "+{0} more", provider.models.length - 5);
				}
			} else if (provider.available) {
				const empty = append(details, $('span.onboarding-a-provider-empty'));
				empty.textContent = localize('onboarding.models.empty', "Server found; no downloaded model reported.");
			}

			const selection = append(card, $('.onboarding-a-provider-selection'));
			selection.appendChild(renderIcon(provider.selected ? Codicon.check : Codicon.circleLargeOutline));
			this.stepDisposables.add(addDisposableListener(card, EventType.CLICK, () => {
				provider.selected = !provider.selected;
				this.logAction(provider.selected ? 'selectProvider' : 'deselectProvider', provider.definition.id);
				this.renderCurrentStep();
				this.focusCurrentStepElement();
			}));
		}
	}

	private async pullOllamaModel(modelId: string, selectRole?: ModelRole): Promise<void> {
		if (this.downloadingModels.has(modelId)) {
			return;
		}
		this.downloadingModels.set(modelId, { status: localize('onboarding.models.preparing', "Preparing download…"), progress: 2 });
		this.renderCurrentStep();

		try {
			const response = await fetch('http://127.0.0.1:11434/api/pull', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: modelId, stream: true })
			});

			if (!response.body) {
				throw new Error('No streaming response body');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.trim()) {
						continue;
					}
					try {
						const json = JSON.parse(line);
						let progress = 2;
						if (json.total && json.completed) {
							progress = Math.min(99, Math.round((json.completed / json.total) * 100));
						}
						const status = this.formatDownloadStatus(json.status, progress);
						this.downloadingModels.set(modelId, { status, progress });
						this.updateDownloadProgress(modelId, status, progress);
					} catch {}
				}
			}

			this.downloadingModels.delete(modelId);
			await this.scanLocalProviders();
			if (selectRole) {
				this.selectModel({
					id: modelId,
					name: modelId,
					providerId: 'ollama',
					category: selectRole,
					parameterSize: this.guessParameterSize(modelId),
					description: localize('onboarding.models.huggingFaceModel', "Pulled from Hugging Face through Ollama"),
					installed: true,
					providerName: 'Ollama',
					downloadable: false,
				}, selectRole);
				this.customHuggingFaceModel = '';
			}
		} catch (err) {
			const status = localize('onboarding.models.downloadFailed', "Download failed");
			this.downloadingModels.set(modelId, { status, progress: 0 });
			this.updateDownloadProgress(modelId, status, 0);
			setTimeout(() => {
				this.downloadingModels.delete(modelId);
				this.renderCurrentStep();
			}, 3500);
		}
	}

	private formatDownloadStatus(rawStatus: unknown, progress: number): string {
		const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
		if (progress > 2 && progress < 100) {
			return localize('onboarding.models.downloadingProgress', "Downloading · {0}%", progress);
		}
		if (status.includes('verif')) {
			return localize('onboarding.models.verifying', "Verifying…");
		}
		if (status.includes('writ') || status.includes('success') || status.includes('complete')) {
			return localize('onboarding.models.finishing', "Finishing…");
		}
		return localize('onboarding.models.preparing', "Preparing download…");
	}

	private updateDownloadProgress(modelId: string, status: string, progress: number): void {
		const elements = this.downloadProgressElements.get(modelId);
		if (!elements) {
			return;
		}
		elements.fill.style.width = `${progress}%`;
		elements.text.textContent = status;
		elements.box.setAttribute('aria-valuenow', String(progress));
		elements.box.setAttribute('aria-valuetext', status);
	}

	private async scanLocalProviders(announce = false): Promise<void> {
		const generation = ++this.scanGeneration;
		this.isScanning = true;
		if (this.isShowing && this.isModelSetupStep()) {
			this.renderCurrentStep();
		}

		const detected = await Promise.all(LOCAL_PROVIDER_DEFINITIONS.map(definition => this.detectLocalProvider(definition)));
		if (generation !== this.scanGeneration) {
			return;
		}

		this.detectedProviders = detected;
		const ollama = detected.find(provider => provider.definition.id === 'ollama' && provider.available);
		if (ollama?.models.length) {
			if (this.selectedAgentProviderId === 'ollama' && !this.hasLocalModel(ollama.models, this.selectedAgentModel)) {
				this.selectedAgentModel = ollama.models.find(model => this.guessModelRole(model) === 'agent') ?? ollama.models[0];
			}
			if (this.selectedCompletionProviderId === 'ollama' && !this.hasLocalModel(ollama.models, this.selectedCompletionModel)) {
				this.selectedCompletionModel = ollama.models.find(model => this.guessModelRole(model) === 'completion') ?? ollama.models[0];
			}
		}
		this.isScanning = false;
		if (announce) {
			this.accessibilityService.alert(this.localModelsSummary());
		}
		if (this.isShowing && this.isModelSetupStep()) {
			this.renderCurrentStep();
		}
	}

	private isModelSetupStep(): boolean {
		const step = this.steps[this.currentStepIndex];
		return step === OnboardingStepId.Runtime || step === OnboardingStepId.AgentModel || step === OnboardingStepId.CompletionModel;
	}

	private async detectLocalProvider(definition: ILocalProviderDefinition): Promise<IDetectedLocalProvider> {
		try {
			const response = await this.requestService.request({
				type: 'GET',
				url: definition.modelsUrl,
				disableCache: true,
				timeout: 1600,
				callSite: `welcomeOnboarding.detect.${definition.id}`,
			}, CancellationToken.None);

			const models = definition.id === 'ollama'
				? this.parseOllamaModels(await asJson<IOllamaTagsResponse>(response))
				: this.parseOpenAIModels(await asJson<IOpenAIModelsResponse>(response));
			return { definition, available: true, models, selected: true };
		} catch {
			return { definition, available: false, models: [], selected: false };
		}
	}

	private parseOllamaModels(response: IOllamaTagsResponse | null): readonly string[] {
		return this.uniqueModelNames(response?.models?.map(model => model.name ?? model.model ?? '') ?? []);
	}

	private parseOpenAIModels(response: IOpenAIModelsResponse | null): readonly string[] {
		return this.uniqueModelNames(response?.data?.map(model => model.id ?? '') ?? []);
	}

	private uniqueModelNames(names: readonly string[]): readonly string[] {
		return [...new Set(names.map(name => name.trim()).filter(name => name.length > 0))];
	}

	private hasLocalModel(models: readonly string[], modelId: string): boolean {
		return models.some(model => model === modelId || model === `${modelId}:latest` || `${model}:latest` === modelId);
	}

	private localModelsSummary(): string {
		const providers = this.detectedProviders.filter(provider => provider.available);
		const modelCount = providers.reduce((count, provider) => count + provider.models.length, 0);
		if (providers.length === 0) {
			return localize('onboarding.models.none', "No local server detected — you can add one later.");
		}
		if (modelCount === 0) {
			return localize('onboarding.models.serversFound', "Found {0} local model server(s).", providers.length);
		}
		return localize('onboarding.models.found', "Found {0} model(s) across {1} local server(s).", modelCount, providers.length);
	}

	private async configureSelectedProviders(): Promise<void> {
		const existingGroups = this.languageModelsConfigurationService.getLanguageModelsProviderGroups();
		let hasDefaultProfile = existingGroups.some(group => group.isDefaultProfile === true && group.enabled !== false);
		const selectedProviders = this.detectedProviders.filter(provider => provider.available && provider.selected);

		this.isConfiguring = true;
		if (this.nextButton) {
			this.nextButton.disabled = true;
			this.nextButton.textContent = localize('onboarding.models.adding', "Configuring AI engine…");
		}

		for (const provider of selectedProviders) {
			const models = [...provider.models];
			if (provider.definition.id === this.selectedAgentProviderId && !models.includes(this.selectedAgentModel)) {
				models.push(this.selectedAgentModel);
			}
			if (provider.definition.id === this.selectedCompletionProviderId && !models.includes(this.selectedCompletionModel)) {
				models.push(this.selectedCompletionModel);
			}
			const cachedModels = models.map(model => ({
				id: model,
				name: model,
				maxInputTokens: 128000,
				maxOutputTokens: 8192,
				toolCalling: true,
				vision: false,
			}));
			const modelDefaults = {
				cachedModels,
				enabled: true,
				isDefaultProfile: !hasDefaultProfile,
				...(provider.definition.id === this.selectedAgentProviderId ? { defaultChatModel: this.selectedAgentModel } : {}),
				...(provider.definition.id === this.selectedCompletionProviderId ? { defaultCodingModel: this.selectedCompletionModel, fastModel: this.selectedCompletionModel } : {}),
			};
			const providerConfiguration = provider.definition.id === 'ollama'
				? { url: 'http://127.0.0.1:11434', ...modelDefaults }
				: { baseUrl: 'http://127.0.0.1:1234/v1', authType: 'none', ...modelDefaults };
			try {
				await this.languageModelsService.addLanguageModelsProviderGroup(`${provider.definition.name} Local`, provider.definition.id, providerConfiguration);
				this.configuredProviderIds.add(provider.definition.id);
				hasDefaultProfile = true;
			} catch {
				// Provider configuration is best-effort; onboarding remains usable.
			}
		}

		this.isConfiguring = false;
		if (this.nextButton) {
			this.nextButton.disabled = false;
		}
	}

	private renderReadyStep(container: HTMLElement): void {
		const hero = append(container, $('.onboarding-a-ready'));
		const mark = append(hero, $('.onboarding-a-ready-mark'));
		mark.setAttribute('aria-hidden', 'true');
		const message = append(hero, $('p.onboarding-a-ready-message'));
		message.textContent = localize('onboarding.ready.local', "Your Pointer theme, Sidebar Agent ({0}) and Tab Completion ({1}) are configured.", this.selectedAgentModel, this.selectedCompletionModel);

		const features = append(hero, $('.onboarding-a-ready-features'));
		this.renderReadyFeature(features, Codicon.colorMode, localize('onboarding.ready.theme', "Pointer theme"), this.selectedThemeId.replace('-', ' ').toUpperCase());
		this.renderReadyFeature(
			features,
			Codicon.robot,
			localize('onboarding.ready.agent', "Sidebar Agent"),
			this.selectedAgentModel,
		);
		this.renderReadyFeature(
			features,
			Codicon.zap,
			localize('onboarding.ready.completion', "Tab Completion"),
			this.selectedCompletionModel,
		);

		const manageModelsButton = this.registerStepFocusable(append(hero, $<HTMLButtonElement>('button.onboarding-a-manage-models')));
		manageModelsButton.type = 'button';
		manageModelsButton.appendChild(renderIcon(Codicon.settingsGear));
		manageModelsButton.append(localize('onboarding.ready.manageModels', "Manage Language Models"));
		this.stepDisposables.add(addDisposableListener(manageModelsButton, EventType.CLICK, () => {
			this.logAction('manageModels');
			this.dismiss();
			void this.commandService.executeCommand('workbench.action.openLanguageModelsJson');
		}));
	}

	private renderReadyFeature(parent: HTMLElement, icon: typeof Codicon.colorMode, label: string, value: string): void {
		const item = append(parent, $('.onboarding-a-ready-feature'));
		const iconElement = append(item, $('span.onboarding-a-ready-feature-icon'));
		iconElement.appendChild(renderIcon(icon));
		const copy = append(item, $('.onboarding-a-ready-feature-copy'));
		const labelElement = append(copy, $('span.onboarding-a-ready-feature-label'));
		labelElement.textContent = label;
		const valueElement = append(copy, $('span.onboarding-a-ready-feature-value'));
		valueElement.textContent = value;
	}

	private setupRadioGroupNavigation(items: readonly HTMLButtonElement[], selectedIndex: number): void {
		for (let index = 0; index < items.length; index++) {
			items[index].tabIndex = index === selectedIndex ? 0 : -1;
			this.stepDisposables.add(addDisposableListener(items[index], EventType.KEY_DOWN, event => {
				const keyboardEvent = new StandardKeyboardEvent(event);
				let nextIndex: number | undefined;
				if (keyboardEvent.keyCode === KeyCode.RightArrow || keyboardEvent.keyCode === KeyCode.DownArrow) {
					nextIndex = (index + 1) % items.length;
				} else if (keyboardEvent.keyCode === KeyCode.LeftArrow || keyboardEvent.keyCode === KeyCode.UpArrow) {
					nextIndex = (index - 1 + items.length) % items.length;
				}

				if (nextIndex !== undefined) {
					event.preventDefault();
					items[index].tabIndex = -1;
					items[nextIndex].tabIndex = 0;
					items[nextIndex].focus();
					items[nextIndex].click();
				}
			}));
		}
	}

	private trapTab(event: KeyboardEvent, shiftKey: boolean): void {
		const focusable = this.getFocusableElements();
		if (focusable.length === 0) {
			event.preventDefault();
			return;
		}

		const activeElement = getActiveWindow().document.activeElement;
		if (shiftKey && activeElement === focusable[0]) {
			event.preventDefault();
			focusable[focusable.length - 1].focus();
		} else if (!shiftKey && activeElement === focusable[focusable.length - 1]) {
			event.preventDefault();
			focusable[0].focus();
		}
	}

	private getFocusableElements(): readonly HTMLElement[] {
		const elements = [			...this.stepFocusableElements,
			...this.footerFocusableElements,
		];
		return elements.filter(element => this.isTabbable(element));
	}

	private focusCurrentStepElement(): void {
		const firstStepElement = this.stepFocusableElements.find(element => this.isTabbable(element));
		(firstStepElement ?? this.getFocusableElements()[0])?.focus();
	}

	private registerStepFocusable<T extends HTMLElement>(element: T): T {
		this.stepFocusableElements.push(element);
		return element;
	}

	private isTabbable(element: HTMLElement): boolean {
		if (!element.isConnected || element.tabIndex === -1 || element.hasAttribute('disabled')) {
			return false;
		}
		const style = getActiveWindow().getComputedStyle(element);
		return style.display !== 'none' && style.visibility !== 'hidden';
	}

	private logAction(action: string, argument?: string): void {
		this.telemetryService.publicLog2<OnboardingActionEvent, OnboardingActionClassification>('welcomeOnboarding.actionExecuted', {
			action,
			step: this.steps[this.currentStepIndex],
			argument,
		});
	}

	private removeFromDom(): void {
		this.overlay?.remove();
		this.overlay = undefined;
		this.card = undefined;
		this.progressContainer = undefined;
		this.titleElement = undefined;
		this.subtitleElement = undefined;
		this.contentElement = undefined;
		this.backButton = undefined;
		this.nextButton = undefined;		this.stepFocusableElements.length = 0;
		this.footerFocusableElements.length = 0;
		this.currentStepIndex = 0;
		this.isShowing = false;
		this.viewDisposables.clear();
		this.stepDisposables.clear();
		this.previouslyFocusedElement?.focus();
		this.previouslyFocusedElement = undefined;
	}

	override dispose(): void {
		this.removeFromDom();
		super.dispose();
	}
}
