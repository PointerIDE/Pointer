/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { areSettingsTargetsEqual, findSettingsTreeGroupById, getResettableSettingsInSection, isSettingsSectionForTarget, isTopLevelSettingsCategory, settingKeyToDisplayFormat, parseQuery, IParsedQuery, resolveSettingsTargetForUpdate, sanitizeId, SettingsTreeGroupChild, SettingsTreeGroupElement, SettingsTreeSettingElement } from '../../browser/settingsTreeModels.js';

function createSettingElement(key: string, isConfigured = true, isUntrusted = false, hasPolicyValue = false): SettingsTreeSettingElement {
	const element = Object.create(SettingsTreeSettingElement.prototype) as SettingsTreeSettingElement;
	Object.assign(element, {
		setting: { key },
		isConfigured,
		isUntrusted,
		hasPolicyValue,
		settingsTarget: ConfigurationTarget.USER_LOCAL,
		inspectSelf: () => undefined,
	});
	return element;
}

function createGroupElement(id: string, children: SettingsTreeGroupChild[]): SettingsTreeGroupElement {
	const element = Object.create(SettingsTreeGroupElement.prototype) as SettingsTreeGroupElement;
	Object.assign(element, {
		id,
		label: id,
		level: 0,
		isFirstGroup: false,
	});
	element.children = children;
	return element;
}

suite('SettingsTree', () => {
	test('settingKeyToDisplayFormat', () => {
		assert.deepStrictEqual(
			settingKeyToDisplayFormat('foo.bar'),
			{
				category: 'Foo',
				label: 'Bar'
			});

		assert.deepStrictEqual(
			settingKeyToDisplayFormat('foo.bar.etc'),
			{
				category: 'Foo › Bar',
				label: 'Etc'
			});

		assert.deepStrictEqual(
			settingKeyToDisplayFormat('fooBar.etcSomething'),
			{
				category: 'Foo Bar',
				label: 'Etc Something'
			});

		assert.deepStrictEqual(
			settingKeyToDisplayFormat('foo'),
			{
				category: '',
				label: 'Foo'
			});

		assert.deepStrictEqual(
			settingKeyToDisplayFormat('foo.1leading.number'),
			{
				category: 'Foo › 1leading',
				label: 'Number'
			});

		assert.deepStrictEqual(
			settingKeyToDisplayFormat('foo.1Leading.number'),
			{
				category: 'Foo › 1 Leading',
				label: 'Number'
			});
	});

	test('settingKeyToDisplayFormat - with category', () => {
		assert.deepStrictEqual(
			settingKeyToDisplayFormat('foo.bar', 'foo'),
			{
				category: '',
				label: 'Bar'
			});

		assert.deepStrictEqual(
			settingKeyToDisplayFormat('disableligatures.ligatures', 'disableligatures'),
			{
				category: '',
				label: 'Ligatures'
			});

		assert.deepStrictEqual(
			settingKeyToDisplayFormat('foo.bar.etc', 'foo'),
			{
				category: 'Bar',
				label: 'Etc'
			});

		assert.deepStrictEqual(
			settingKeyToDisplayFormat('fooBar.etcSomething', 'foo'),
			{
				category: 'Foo Bar',
				label: 'Etc Something'
			});

		assert.deepStrictEqual(
			settingKeyToDisplayFormat('foo.bar.etc', 'foo/bar'),
			{
				category: '',
				label: 'Etc'
			});

		assert.deepStrictEqual(
			settingKeyToDisplayFormat('foo.bar.etc', 'something/foo'),
			{
				category: 'Bar',
				label: 'Etc'
			});

		assert.deepStrictEqual(
			settingKeyToDisplayFormat('bar.etc', 'something.bar'),
			{
				category: '',
				label: 'Etc'
			});

		assert.deepStrictEqual(
			settingKeyToDisplayFormat('fooBar.etc', 'fooBar'),
			{
				category: '',
				label: 'Etc'
			});


		assert.deepStrictEqual(
			settingKeyToDisplayFormat('fooBar.somethingElse.etc', 'fooBar'),
			{
				category: 'Something Else',
				label: 'Etc'
			});
	});

	test('settingKeyToDisplayFormat - known acronym/term', () => {
		assert.deepStrictEqual(
			settingKeyToDisplayFormat('css.someCssSetting'),
			{
				category: 'CSS',
				label: 'Some CSS Setting'
			});

		assert.deepStrictEqual(
			settingKeyToDisplayFormat('powershell.somePowerShellSetting'),
			{
				category: 'PowerShell',
				label: 'Some PowerShell Setting'
			});
	});

	test('parseQuery', () => {
		function testParseQuery(input: string, expected: IParsedQuery) {
			assert.deepStrictEqual(
				parseQuery(input),
				expected,
				input
			);
		}

		testParseQuery(
			'',
			<IParsedQuery>{
				tags: [],
				extensionFilters: [],
				query: '',
				featureFilters: [],
				idFilters: [],
				languageFilter: undefined
			});

		testParseQuery(
			'@modified',
			<IParsedQuery>{
				tags: ['modified'],
				extensionFilters: [],
				query: '',
				featureFilters: [],
				idFilters: [],
				languageFilter: undefined
			});

		testParseQuery(
			'@tag:foo',
			<IParsedQuery>{
				tags: ['foo'],
				extensionFilters: [],
				query: '',
				featureFilters: [],
				idFilters: [],
				languageFilter: undefined
			});

		testParseQuery(
			'@modified foo',
			<IParsedQuery>{
				tags: ['modified'],
				extensionFilters: [],
				query: 'foo',
				featureFilters: [],
				idFilters: [],
				languageFilter: undefined
			});

		testParseQuery(
			'@tag:foo @modified',
			<IParsedQuery>{
				tags: ['foo', 'modified'],
				extensionFilters: [],
				query: '',
				featureFilters: [],
				idFilters: [],
				languageFilter: undefined
			});

		testParseQuery(
			'@tag:foo @modified my query',
			<IParsedQuery>{
				tags: ['foo', 'modified'],
				extensionFilters: [],
				query: 'my query',
				featureFilters: [],
				idFilters: [],
				languageFilter: undefined
			});

		testParseQuery(
			'test @modified query',
			<IParsedQuery>{
				tags: ['modified'],
				extensionFilters: [],
				query: 'test  query',
				featureFilters: [],
				idFilters: [],
				languageFilter: undefined
			});

		testParseQuery(
			'test @modified',
			<IParsedQuery>{
				tags: ['modified'],
				extensionFilters: [],
				query: 'test',
				featureFilters: [],
				idFilters: [],
				languageFilter: undefined
			});

		testParseQuery(
			'query has @ for some reason',
			<IParsedQuery>{
				tags: [],
				extensionFilters: [],
				query: 'query has @ for some reason',
				featureFilters: [],
				idFilters: [],
				languageFilter: undefined
			});

		testParseQuery(
			'@ext:github.vscode-pull-request-github',
			<IParsedQuery>{
				tags: [],
				extensionFilters: ['github.vscode-pull-request-github'],
				query: '',
				featureFilters: [],
				idFilters: [],
				languageFilter: undefined
			});

		testParseQuery(
			'@ext:github.vscode-pull-request-github,vscode.git',
			<IParsedQuery>{
				tags: [],
				extensionFilters: ['github.vscode-pull-request-github', 'vscode.git'],
				query: '',
				featureFilters: [],
				idFilters: [],
				languageFilter: undefined
			});
		testParseQuery(
			'@feature:scm',
			<IParsedQuery>{
				tags: [],
				extensionFilters: [],
				featureFilters: ['scm'],
				query: '',
				idFilters: [],
				languageFilter: undefined
			});

		testParseQuery(
			'@feature:scm,terminal',
			<IParsedQuery>{
				tags: [],
				extensionFilters: [],
				featureFilters: ['scm', 'terminal'],
				query: '',
				idFilters: [],
				languageFilter: undefined
			});
		testParseQuery(
			'@id:files.autoSave',
			<IParsedQuery>{
				tags: [],
				extensionFilters: [],
				featureFilters: [],
				query: '',
				idFilters: ['files.autoSave'],
				languageFilter: undefined
			});

		testParseQuery(
			'@id:files.autoSave,terminal.integrated.commandsToSkipShell',
			<IParsedQuery>{
				tags: [],
				extensionFilters: [],
				featureFilters: [],
				query: '',
				idFilters: ['files.autoSave', 'terminal.integrated.commandsToSkipShell'],
				languageFilter: undefined
			});

		testParseQuery(
			'@lang:cpp',
			<IParsedQuery>{
				tags: [],
				extensionFilters: [],
				featureFilters: [],
				query: '',
				idFilters: [],
				languageFilter: 'cpp'
			});

		testParseQuery(
			'@lang:cpp,python',
			<IParsedQuery>{
				tags: [],
				extensionFilters: [],
				featureFilters: [],
				query: '',
				idFilters: [],
				languageFilter: 'cpp'
			});
	});

	test('sanitizeId replaces all dots and slashes', () => {
		assert.deepStrictEqual(
			[
				sanitizeId('root.editor.font.size'),
				sanitizeId('group/subgroup/setting.key'),
				sanitizeId('no-special-chars'),
				sanitizeId('single.dot'),
			],
			[
				'root_editor_font_size',
				'group_subgroup_setting_key',
				'no-special-chars',
				'single_dot',
			]
		);
	});

	test('getResettableSettingsInSection returns only configured, writable direct settings', () => {
		const configured = createSettingElement('configured');
		const unconfigured = createSettingElement('unconfigured', false);
		const untrusted = createSettingElement('untrusted', true, true);
		const policyControlled = createSettingElement('policyControlled', true, false, true);
		const section = createGroupElement('section', [configured, unconfigured, untrusted, policyControlled]);

		assert.deepStrictEqual(getResettableSettingsInSection(section), [configured]);
	});

	test('getResettableSettingsInSection deduplicates settings by key', () => {
		const unconfiguredDuplicate = createSettingElement('duplicate', false);
		const first = createSettingElement('duplicate');
		const duplicate = createSettingElement('duplicate');
		const other = createSettingElement('other');
		const section = createGroupElement('section', [unconfiguredDuplicate, first, duplicate, other]);

		assert.deepStrictEqual(getResettableSettingsInSection(section), [first, other]);
	});

	test('getResettableSettingsInSection excludes settings in nested groups', () => {
		const direct = createSettingElement('direct');
		const nested = createSettingElement('nested');
		const nestedGroup = createGroupElement('nestedGroup', [nested]);
		const section = createGroupElement('section', [direct, nestedGroup]);

		assert.deepStrictEqual(getResettableSettingsInSection(section), [direct]);
	});

	test('getResettableSettingsInSection inspects offscreen settings before evaluating eligibility', () => {
		const offscreen = createSettingElement('offscreen', false);
		offscreen.inspectSelf = () => offscreen.isConfigured = true;
		const section = createGroupElement('section', [offscreen]);

		assert.deepStrictEqual(getResettableSettingsInSection(section), [offscreen]);
	});

	test('settings section target checks reject stale groups', () => {
		const firstFolder = URI.file('c:/workspace/first');
		const sameFolder = URI.file('c:/workspace/first');
		const otherFolder = URI.file('c:/workspace/other');
		assert.strictEqual(areSettingsTargetsEqual(firstFolder, sameFolder), true);
		assert.strictEqual(areSettingsTargetsEqual(firstFolder, otherFolder), false);
		assert.strictEqual(areSettingsTargetsEqual(ConfigurationTarget.USER_LOCAL, ConfigurationTarget.WORKSPACE), false);

		const setting = createSettingElement('stale');
		const section = createGroupElement('section', [setting]);
		assert.strictEqual(isSettingsSectionForTarget(section, ConfigurationTarget.USER_LOCAL), true);
		assert.strictEqual(isSettingsSectionForTarget(section, ConfigurationTarget.WORKSPACE), false);
	});

	test('settings update target override remains immutable', () => {
		assert.strictEqual(resolveSettingsTargetForUpdate(ConfigurationTarget.WORKSPACE, ConfigurationTarget.USER_LOCAL), ConfigurationTarget.USER_LOCAL);
		assert.strictEqual(resolveSettingsTargetForUpdate(ConfigurationTarget.WORKSPACE), ConfigurationTarget.WORKSPACE);
		assert.strictEqual(resolveSettingsTargetForUpdate(null), ConfigurationTarget.USER_LOCAL);
	});

	test('category reveal remains pending until the current settings model exists', () => {
		assert.strictEqual(findSettingsTreeGroupById(undefined, 'chat'), undefined);

		const agent = createGroupElement('chat/agent', []);
		const chat = createGroupElement('chat', [agent]);
		const root = createGroupElement('root', [chat]);
		agent.parent = chat;
		chat.parent = root;

		assert.strictEqual(findSettingsTreeGroupById(root, 'chat'), chat);
		assert.strictEqual(findSettingsTreeGroupById(root, 'chat/agent'), agent);
		assert.strictEqual(findSettingsTreeGroupById(root, 'missing'), undefined);
	});

	test('provider management matches the exact AI & Models top-level category only', () => {
		const agent = createGroupElement('chat/agent', []);
		const chat = createGroupElement('chat', [agent]);
		const root = createGroupElement('root', [chat]);
		agent.parent = chat;
		chat.parent = root;

		assert.strictEqual(isTopLevelSettingsCategory(chat, 'chat'), true);
		assert.strictEqual(isTopLevelSettingsCategory(agent, 'chat'), false);
		assert.strictEqual(isTopLevelSettingsCategory(root, 'chat'), false);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
