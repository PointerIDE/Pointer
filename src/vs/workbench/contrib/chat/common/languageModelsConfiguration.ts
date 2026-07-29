/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { IStringDictionary } from '../../../../base/common/collections.js';

export const ILanguageModelsConfigurationService = createDecorator<ILanguageModelsConfigurationService>('ILanguageModelsConfigurationService');

export interface ConfigureLanguageModelsOptions {
	group: ILanguageModelsProviderGroup;
	snippet?: string;
}

export interface ILanguageModelsConfigurationService {
	readonly _serviceBrand: undefined;

	readonly configurationFile: URI;

	readonly onDidChangeLanguageModelGroups: Event<readonly ILanguageModelsProviderGroup[]>;

	getLanguageModelsProviderGroups(): readonly ILanguageModelsProviderGroup[];

	addLanguageModelsProviderGroup(languageModelsProviderGroup: ILanguageModelsProviderGroup): Promise<ILanguageModelsProviderGroup>;

	updateLanguageModelsProviderGroup(from: ILanguageModelsProviderGroup, to: ILanguageModelsProviderGroup): Promise<ILanguageModelsProviderGroup>;

	removeLanguageModelsProviderGroup(languageModelGroup: ILanguageModelsProviderGroup): Promise<void>;

	configureLanguageModels(options?: ConfigureLanguageModelsOptions): Promise<void>;
}

export interface ILanguageModelsProviderGroup extends IStringDictionary<unknown> {
	readonly name: string;
	readonly vendor: string;
	readonly range?: IRange;
	readonly settings?: IStringDictionary<IStringDictionary<unknown>>;
	readonly isDefaultProfile?: boolean;
}

/**
 * Throws when updating a provider group would create a duplicate `(vendor, name)` identity.
 */
export function assertNoLanguageModelsProviderGroupCollision(
	groups: readonly ILanguageModelsProviderGroup[],
	from: ILanguageModelsProviderGroup,
	to: ILanguageModelsProviderGroup
): void {
	const sourceIndex = groups.findIndex(group => group.vendor === from.vendor && group.name === from.name);
	const hasCollision = groups.some((group, index) => index !== sourceIndex && group.vendor === to.vendor && group.name === to.name);
	if (hasCollision) {
		throw new Error(`Language model group with name ${to.name} already exists for vendor ${to.vendor}`);
	}
}

/**
 * Ensures that at most one enabled provider group carries the explicit default-profile intent.
 */
export function normalizeLanguageModelsDefaultProfiles(
	groups: readonly ILanguageModelsProviderGroup[],
	preferred?: ILanguageModelsProviderGroup
): ILanguageModelsProviderGroup[] {
	const preferredKey = preferred?.isDefaultProfile === true && preferred.enabled !== false
		? `${preferred.vendor}:${preferred.name}`
		: undefined;
	let fallbackKey: string | undefined;
	if (!preferredKey) {
		for (const group of groups) {
			if (group.isDefaultProfile === true && group.enabled !== false) {
				fallbackKey = `${group.vendor}:${group.name}`;
				break;
			}
		}
	}
	const selectedKey = preferredKey ?? fallbackKey;
	return groups.map(group => {
		const key = `${group.vendor}:${group.name}`;
		if (group.enabled === false) {
			return group.isDefaultProfile === false ? group : { ...group, isDefaultProfile: false };
		}
		if (selectedKey && key === selectedKey) {
			return group.isDefaultProfile === true ? group : { ...group, isDefaultProfile: true };
		}
		if (group.isDefaultProfile === true) {
			return { ...group, isDefaultProfile: false };
		}
		return group;
	});
}
