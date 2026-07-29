/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IProductOnboardingTheme } from '../../../../base/common/product.js';

export type HardwareTier = 'compact' | 'balanced' | 'pro';

export interface IHardwareInfo {
	readonly ramGb: number;
	readonly cpuCores: number;
	readonly tier: HardwareTier;
	readonly label: string;
}

export type ModelCategory = 'agent' | 'completion';

export interface IOllamaCatalogModel {
	readonly id: string;
	readonly name: string;
	readonly category: ModelCategory;
	readonly parameterSize: string;
	readonly minRamGb: number;
	readonly recommendedTier: HardwareTier;
	readonly description: string;
	readonly isDefaultAgent?: boolean;
	readonly isDefaultCompletion?: boolean;
}

/**
 * Step identifiers for Pointer's first-launch setup.
 */
export const enum OnboardingStepId {
	Theme = 'onboarding.theme',
	Runtime = 'onboarding.runtime',
	AgentModel = 'onboarding.agentModel',
	CompletionModel = 'onboarding.completionModel',
	Ready = 'onboarding.ready',
}

/**
 * Returns a localized title for each setup step.
 */
export function getOnboardingStepTitle(stepId: OnboardingStepId): string {
	switch (stepId) {
		case OnboardingStepId.Theme:
			return localize('onboarding.step.theme', "Choose your theme");
		case OnboardingStepId.Runtime:
			return localize('onboarding.step.runtime', "Connect your local runtime");
		case OnboardingStepId.AgentModel:
			return localize('onboarding.step.agentModel', "Choose an agent model");
		case OnboardingStepId.CompletionModel:
			return localize('onboarding.step.completionModel', "Choose a completion model");
		case OnboardingStepId.Ready:
			return localize('onboarding.step.ready', "You're ready");
	}
}

/**
 * Returns a localized subtitle for each setup step.
 */
export function getOnboardingStepSubtitle(stepId: OnboardingStepId): string {
	switch (stepId) {
		case OnboardingStepId.Theme:
			return localize('onboarding.step.theme.subtitle', "Pick the look that feels right. You can change it later in Settings.");
		case OnboardingStepId.Runtime:
			return localize('onboarding.step.runtime.subtitle', "Pointer found the model servers on this device. Choose which ones to use.");
		case OnboardingStepId.AgentModel:
			return localize('onboarding.step.agentModel.subtitle', "Pick a model for planning, tools and multi-file work. You can install one here.");
		case OnboardingStepId.CompletionModel:
			return localize('onboarding.step.completionModel.subtitle', "Pick any installed model for inline suggestions. Faster models usually feel best.");
		case OnboardingStepId.Ready:
			return localize('onboarding.step.ready.subtitle', "Your workspace is set up. You can adjust any of these choices later.");
	}
}

/**
 * Ordered steps for the first-launch setup. Theme selection intentionally comes first.
 */
export const ONBOARDING_STEPS: readonly OnboardingStepId[] = [
	OnboardingStepId.Theme,
	OnboardingStepId.Runtime,
	OnboardingStepId.AgentModel,
	OnboardingStepId.CompletionModel,
	OnboardingStepId.Ready,
];

/**
 * Theme option shown by Pointer's setup flow.
 */
export type IOnboardingThemeOption = IProductOnboardingTheme;

/**
 * High-end product themes.
 */
export const POINTER_ONBOARDING_THEMES: readonly IOnboardingThemeOption[] = [
	{
		id: 'pointer-dark',
		label: 'Pointer Dark',
		themeId: 'Pointer Dark',
		type: 'dark',
	},
	{
		id: 'pointer-obsidian',
		label: 'Pointer Obsidian',
		themeId: 'Pointer Obsidian',
		type: 'dark',
	},
	{
		id: 'pointer-cyber',
		label: 'Pointer Cyber',
		themeId: 'Pointer Cyber',
		type: 'dark',
	},
	{
		id: 'pointer-light',
		label: 'Pointer Light',
		themeId: 'Pointer Light',
		type: 'light',
	},
];

/**
 * Curated list of top Ollama models, tailored for hardware capabilities
 * and assigned to Sidebar Agent or Tab Code Completion roles.
 */
export const TOP_OLLAMA_MODELS: readonly IOllamaCatalogModel[] = [
	// --- SIDEBAR AGENT MODELS ---
	{
		id: 'qwen2.5-coder:7b',
		name: 'Qwen 2.5 Coder 7B',
		category: 'agent',
		parameterSize: '7B',
		minRamGb: 8,
		recommendedTier: 'balanced',
		description: 'Balanced coding model for project-wide edits, refactors and tool use.',
		isDefaultAgent: true,
	},
	{
		id: 'deepseek-r1:8b',
		name: 'DeepSeek R1 8B',
		category: 'agent',
		parameterSize: '8B',
		minRamGb: 8,
		recommendedTier: 'balanced',
		description: 'Reasoning-focused model for architecture, debugging and complex tasks.',
	},
	{
		id: 'llama3.1:8b',
		name: 'Meta Llama 3.1 8B',
		category: 'agent',
		parameterSize: '8B',
		minRamGb: 8,
		recommendedTier: 'balanced',
		description: 'General-purpose model with a large context window.',
	},
	{
		id: 'qwen2.5-coder:1.5b',
		name: 'Qwen 2.5 Coder 1.5B',
		category: 'agent',
		parameterSize: '1.5B',
		minRamGb: 4,
		recommendedTier: 'compact',
		description: 'Small, responsive model for lighter machines.',
	},
	{
		id: 'deepseek-r1:14b',
		name: 'DeepSeek R1 14B',
		category: 'agent',
		parameterSize: '14B',
		minRamGb: 16,
		recommendedTier: 'pro',
		description: 'Larger reasoning model for demanding development work.',
	},
	// --- CODE COMPLETION (FIM / TAB) MODELS ---
	{
		id: 'qwen2.5-coder:1.5b-base',
		name: 'Qwen 2.5 Coder 1.5B (FIM)',
		category: 'completion',
		parameterSize: '1.5B',
		minRamGb: 4,
		recommendedTier: 'compact',
		description: 'Compact Fill-In-Middle model for responsive inline suggestions.',
		isDefaultCompletion: true,
	},
	{
		id: 'qwen2.5-coder:7b-base',
		name: 'Qwen 2.5 Coder 7B (FIM)',
		category: 'completion',
		parameterSize: '7B',
		minRamGb: 8,
		recommendedTier: 'balanced',
		description: 'Larger Fill-In-Middle model for more context-aware suggestions.',
	},
	{
		id: 'deepseek-coder:6.7b-base',
		name: 'DeepSeek Coder 6.7B (FIM)',
		category: 'completion',
		parameterSize: '6.7B',
		minRamGb: 8,
		recommendedTier: 'balanced',
		description: 'Multi-language model tuned for inline completion.',
	},
	{
		id: 'starcoder2:3b',
		name: 'StarCoder2 3B',
		category: 'completion',
		parameterSize: '3B',
		minRamGb: 4,
		recommendedTier: 'compact',
		description: 'Small open model for completion across many languages.',
	},
];

/**
 * Versioned application-scoped completion key. Changing the version deliberately
 * presents a materially revised setup once to existing Pointer installations.
 */
export const ONBOARDING_STORAGE_KEY = 'pointer.welcomeOnboarding.v2.completed';
