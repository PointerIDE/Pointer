/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancelablePromise } from '../../../../base/common/async.js';

/**
 * Clears the Settings search before revealing a category. Cancelling after `setValue` is intentional:
 * changing the input schedules a new delayed search, which must not later clear the revealed category.
 */
export function clearSettingsSearchForCategoryReveal(
	searchWidget: { setValue(value: string): void },
	searchInputDelayer: { cancel(): void },
	viewState: { query?: string }
): void {
	searchWidget.setValue('');
	searchInputDelayer.cancel();
	viewState.query = '';
}

/**
 * Cancels an in-flight AI Settings search and returns the empty state to assign to its owner.
 * Clearing the reference is important because a deferred result must no longer be considered active.
 */
export function cancelSettingsAiSearch(searchPromise: CancelablePromise<void> | null): null {
	if (searchPromise) {
		void searchPromise.catch(() => undefined);
		searchPromise.cancel();
	}
	return null;
}
