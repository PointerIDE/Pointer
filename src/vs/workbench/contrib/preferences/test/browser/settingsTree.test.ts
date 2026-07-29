/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ITreeNode } from '../../../../../base/browser/ui/tree/tree.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { SettingGroupRenderer } from '../../browser/settingsTree.js';
import { SettingsTreeGroupElement, SettingsTreeSettingElement } from '../../browser/settingsTreeModels.js';

function createSettingElement(key: string, isConfigured: boolean): SettingsTreeSettingElement {
	const element = Object.create(SettingsTreeSettingElement.prototype) as SettingsTreeSettingElement;
	Object.assign(element, {
		setting: { key },
		isConfigured,
		isUntrusted: false,
		hasPolicyValue: false,
		settingsTarget: ConfigurationTarget.USER_LOCAL,
		inspectSelf: () => undefined,
	});
	return element;
}

function createTreeNode(element: SettingsTreeGroupElement): ITreeNode<SettingsTreeGroupElement, never> {
	return {
		element,
		children: [],
		depth: 1,
		visibleChildrenCount: element.children.length,
		visibleChildIndex: 0,
		collapsible: false,
		collapsed: false,
		visible: true,
		filterData: undefined,
	};
}

suite('SettingGroupRenderer', () => {
	const disposables = new DisposableStore();

	teardown(() => disposables.clear());

	test('shows reset only for resettable direct settings and fires the current group', () => {
		const resetRequests: SettingsTreeGroupElement[] = [];
		const renderer = new SettingGroupRenderer(group => resetRequests.push(group));
		const container = document.createElement('div');
		const template = renderer.renderTemplate(container);
		disposables.add({ dispose: () => renderer.disposeTemplate(template) });

		const unconfiguredGroup = disposables.add(new SettingsTreeGroupElement('unconfigured', undefined, 'Unconfigured', 1, false));
		unconfiguredGroup.children = [createSettingElement('test.unconfigured', false)];
		renderer.renderElement(createTreeNode(unconfiguredGroup), 0, template);
		const resetButton = container.querySelector<HTMLAnchorElement>('.settings-group-reset-button');
		assert.ok(resetButton);
		assert.strictEqual(resetButton.style.display, 'none');

		const configuredGroup = disposables.add(new SettingsTreeGroupElement('configured', undefined, 'Configured', 1, false));
		configuredGroup.children = [createSettingElement('test.configured', true)];
		renderer.renderElement(createTreeNode(configuredGroup), 0, template);
		assert.strictEqual(resetButton.style.display, '');
		resetButton.click();

		assert.deepStrictEqual(resetRequests, [configuredGroup]);
	});

	test('keeps the reset button out of the tab order until the group is tabbable', () => {
		const renderer = new SettingGroupRenderer(() => undefined);
		const container = document.createElement('div');
		const template = renderer.renderTemplate(container);
		disposables.add({ dispose: () => renderer.disposeTemplate(template) });
		const group = disposables.add(new SettingsTreeGroupElement('configured', undefined, 'Configured', 1, false));
		group.children = [createSettingElement('test.configured', true)];

		renderer.renderElement(createTreeNode(group), 0, template);
		const resetButton = container.querySelector<HTMLAnchorElement>('.settings-group-reset-button');
		assert.ok(resetButton);
		assert.strictEqual(resetButton.tabIndex, -1);

		group.tabbable = true;
		assert.strictEqual(resetButton.tabIndex, 0);
		group.tabbable = false;
		assert.strictEqual(resetButton.tabIndex, -1);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
