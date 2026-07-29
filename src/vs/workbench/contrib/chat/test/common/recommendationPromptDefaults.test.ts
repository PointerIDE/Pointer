/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { shouldPromptForAgentPluginRecommendations } from '../../browser/claudePluginRecommendations.js';
import { DEFAULT_IGNORE_EXTENSION_RECOMMENDATIONS } from '../../../extensions/browser/extensionRecommendationNotificationService.js';

suite('Automatic recommendation prompts', () => {

	test('extension recommendation notifications are ignored by default', () => {
		assert.strictEqual(DEFAULT_IGNORE_EXTENSION_RECOMMENDATIONS, true);
	});

	test('does not prompt for agent plugins when extension recommendations are ignored', () => {
		const configurationService = new TestConfigurationService({ 'extensions.ignoreRecommendations': true });

		assert.strictEqual(shouldPromptForAgentPluginRecommendations(configurationService), false);
	});

	test('agent plugin recommendations can still be enabled explicitly', () => {
		const configurationService = new TestConfigurationService({ 'extensions.ignoreRecommendations': false });

		assert.strictEqual(shouldPromptForAgentPluginRecommendations(configurationService), true);
	});
});
