/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { parseLanguageModelsProviderGroups } from '../../browser/languageModelsConfigurationService.js';
import { assertNoLanguageModelsProviderGroupCollision, ILanguageModelsProviderGroup, normalizeLanguageModelsDefaultProfiles } from '../../common/languageModelsConfiguration.js';

suite('LanguageModelsConfiguration', () => {
	const testDisposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('parseLanguageModelsConfiguration - empty', () => {
		const model = testDisposables.add(createTextModel('[]'));
		const result = parseLanguageModelsProviderGroups(model);
		assert.deepStrictEqual(result, []);
	});

	test('parseLanguageModelsConfiguration - simple', () => {
		const content = JSON.stringify([{
			vendor: 'vendor',
			name: 'group',
			configurations: []
		}], null, '\t');
		const model = testDisposables.add(createTextModel(content));
		const result = parseLanguageModelsProviderGroups(model);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, 'group');
		assert.strictEqual(result[0].vendor, 'vendor');
		assert.ok(result[0].range);
	});

	test('parseLanguageModelsConfiguration - with configuration range', () => {
		const content = `[
	{
		"vendor": "vendor",
		"name": "group",
		"configurations": [
			{
				"configuration": {
					"foo": "bar"
				}
			}
		]
	}
]`;
		const model = testDisposables.add(createTextModel(content));
		const result = parseLanguageModelsProviderGroups(model);

		const configurations = result[0].configurations as { configuration: Record<string, unknown> }[];
		const config = configurations[0].configuration;
		assert.deepStrictEqual(config, { foo: 'bar' });
	});

	test('parseLanguageModelsConfiguration - multiple vendors and groups', () => {
		const content = `[
	{ "vendor": "vendor1", "name": "g1", "configurations": [] },
	{ "vendor": "vendor1", "name": "g2", "configurations": [] },
	{ "vendor": "vendor2", "name": "g3", "configurations": [] }
]`;
		const model = testDisposables.add(createTextModel(content));
		const result = parseLanguageModelsProviderGroups(model);

		assert.strictEqual(result.length, 3);
		assert.strictEqual(result[0].name, 'g1');
		assert.strictEqual(result[0].vendor, 'vendor1');
		assert.strictEqual(result[1].name, 'g2');
		assert.strictEqual(result[1].vendor, 'vendor1');
		assert.strictEqual(result[2].name, 'g3');
		assert.strictEqual(result[2].vendor, 'vendor2');
	});

	test('parseLanguageModelsConfiguration - complex configuration values', () => {
		const content = `[
	{
		"vendor": "vendor",
		"name": "group",
		"configurations": [
			{
				"configuration": {
					"str": "value",
					"num": 123,
					"bool": true,
					"null": null,
					"arr": [1, 2],
					"obj": { "nested": "val" }
				}
			}
		]
	}
]`;
		const model = testDisposables.add(createTextModel(content));
		const result = parseLanguageModelsProviderGroups(model);

		const configurations = result[0]?.configurations as { configuration: Record<string, unknown> }[];
		const config = configurations[0].configuration;
		assert.strictEqual(config.str, 'value');
		assert.strictEqual(config.num, 123);
		assert.strictEqual(config.bool, true);
		assert.strictEqual(config.null, null);
		assert.deepStrictEqual(config.arr, [1, 2]);
		assert.deepStrictEqual(config.obj, { nested: 'val' });
	});

	test('parseLanguageModelsConfiguration - with comments', () => {
		const content = `[
	// This is a comment
	/* Block comment */
	{
		"vendor": "vendor",
		"name": "group",
		"configurations": []
	}
]`;
		const model = testDisposables.add(createTextModel(content));
		const result = parseLanguageModelsProviderGroups(model);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, 'group');
		assert.strictEqual(result[0].vendor, 'vendor');
	});

	test('parseLanguageModelsConfiguration - ranges', () => {
		const content = `[
	{
		"vendor": "vendor",
		"name": "g1",
		"configurations": []
	},
	{
		"vendor": "vendor",
		"name": "g2",
		"configurations": []
	}
]`;
		const model = testDisposables.add(createTextModel(content));
		const result = parseLanguageModelsProviderGroups(model);

		const g1 = result[0];
		const g2 = result[1];

		assert.ok(g1.range);
		assert.ok(g2.range);
		assert.strictEqual(g1.range.startLineNumber, 2);
		assert.strictEqual(g1.range.endLineNumber, 6);
		assert.strictEqual(g2.range.startLineNumber, 7);
		assert.strictEqual(g2.range.endLineNumber, 11);
	});

	test('rejects a provider group rename to an existing vendor and name', () => {
		const providerA: ILanguageModelsProviderGroup = { vendor: 'vendor', name: 'A', baseUrl: 'https://a.example' };
		const providerB: ILanguageModelsProviderGroup = { vendor: 'vendor', name: 'B', baseUrl: 'https://b.example' };
		const groups = [providerA, providerB];
		const originalGroups = groups.map(group => ({ ...group }));

		assert.throws(
			() => assertNoLanguageModelsProviderGroupCollision(groups, providerA, { ...providerA, name: 'B' }),
			/already exists/
		);
		assert.deepStrictEqual(groups, originalGroups);
	});

	test('normalizes explicit default profile to one provider group', () => {
		const providerA: ILanguageModelsProviderGroup = { vendor: 'vendor-a', name: 'A', isDefaultProfile: true, apiKey: '${input:a}' };
		const providerB: ILanguageModelsProviderGroup = { vendor: 'vendor-b', name: 'B', isDefaultProfile: true, apiKey: '${input:b}' };
		const providerC: ILanguageModelsProviderGroup = { vendor: 'vendor-c', name: 'C', enabled: false, isDefaultProfile: true, apiKey: '${input:c}' };

		const result = normalizeLanguageModelsDefaultProfiles([providerA, providerB, providerC], providerB);

		assert.strictEqual(result.find(group => group.name === 'A')?.isDefaultProfile, false);
		assert.strictEqual(result.find(group => group.name === 'B')?.isDefaultProfile, true);
		assert.strictEqual(result.find(group => group.name === 'C')?.isDefaultProfile, false);
		assert.strictEqual(result.find(group => group.name === 'A')?.apiKey, '${input:a}');
		assert.strictEqual(result.find(group => group.name === 'B')?.apiKey, '${input:b}');
		assert.strictEqual(result.find(group => group.name === 'C')?.apiKey, '${input:c}');
		assert.strictEqual(providerA.isDefaultProfile, true, 'normalization must not mutate the source groups');
	});
});
