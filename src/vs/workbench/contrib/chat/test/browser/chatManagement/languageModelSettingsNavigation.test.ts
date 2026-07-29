/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { createCancelablePromise, DeferredPromise, Delayer, timeout } from '../../../../../../base/common/async.js';
import { isCancellationError } from '../../../../../../base/common/errors.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { cancelSettingsAiSearch, clearSettingsSearchForCategoryReveal } from '../../../../preferences/browser/settingsCategoryNavigation.js';
import { IOpenSettingsOptions } from '../../../../../services/preferences/common/preferences.js';
import { openLanguageModelSettings } from '../../../browser/chatManagement/languageModelSettingsNavigation.js';

suite('Language model Settings navigation', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('routes management to the visual AI & Models category', async () => {
		let capturedOptions: IOpenSettingsOptions | undefined;
		await openLanguageModelSettings({
			openSettings: async options => {
				capturedOptions = options;
				return undefined;
			}
		});

		assert.deepStrictEqual(capturedOptions, {
			jsonEditor: false,
			revealCategory: 'chat',
			focusSearch: false
		});
	});

	test('keeps AI & Models revealed after clearing an active search debounce', async () => {
		const searchInputDelayer = disposables.add(new Delayer<void>(5));
		const viewState = { query: 'editor font' };
		let category: string | undefined = 'search-results';
		let delayedSearch: Promise<void> | undefined;

		await openLanguageModelSettings({
			openSettings: async options => {
				clearSettingsSearchForCategoryReveal({
					setValue: () => {
						delayedSearch = searchInputDelayer.trigger(() => {
							category = undefined;
						});
					}
				}, searchInputDelayer, viewState);
				category = options?.revealCategory;
				return undefined;
			}
		});

		assert.ok(delayedSearch);
		await assert.rejects(delayedSearch, isCancellationError);
		await timeout(20);
		assert.strictEqual(viewState.query, '');
		assert.strictEqual(category, 'chat');
	});

	test('cancels a deferred AI search before it can restore stale search state', async () => {
		const deferredResult = new DeferredPromise<void>();
		let staleSearchResultCreated = false;
		const aiSearchPromise = createCancelablePromise(async token => {
			await deferredResult.p;
			if (!token.isCancellationRequested) {
				staleSearchResultCreated = true;
			}
		});
		const cancellationObserved = aiSearchPromise.then(
			() => undefined,
			() => undefined
		);

		const activeAiSearch = cancelSettingsAiSearch(aiSearchPromise);
		await deferredResult.complete(undefined);
		await cancellationObserved;
		await timeout(0);

		assert.strictEqual(activeAiSearch, null);
		assert.strictEqual(staleSearchResultCreated, false);
	});
});
