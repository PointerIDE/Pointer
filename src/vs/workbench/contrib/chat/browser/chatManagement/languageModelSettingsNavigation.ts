/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEditorPane } from '../../../../common/editor.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';
import { AI_MODELS_SETTINGS_CATEGORY_ID } from '../../../preferences/common/preferences.js';

/** Opens the single visual language-model management surface in Settings. */
export function openLanguageModelSettings(preferencesService: Pick<IPreferencesService, 'openSettings'>): Promise<IEditorPane | undefined> {
	return preferencesService.openSettings({
		jsonEditor: false,
		revealCategory: AI_MODELS_SETTINGS_CATEGORY_ID,
		focusSearch: false
	});
}
