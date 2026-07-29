/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { classifyProviderProcessingLocation, classifyProviderProcessingLocationForProvider } from '../../../browser/chatManagement/providerProcessingLocation.js';

suite('ProviderProcessingLocation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('classifies loopback endpoints as local', () => {
		const endpoints = [
			'http://localhost:11434',
			'https://LOCALHOST./v1',
			'http://models.localhost/v1',
			'http://127.0.0.1:1234',
			'http://127.255.255.254/v1',
			'http://127.1/v1',
			'http://0x7f000001/v1',
			'http://2130706433/v1',
			'http://[::1]:1234',
			'http://[0:0:0:0:0:0:0:1]/v1',
			'http://[::ffff:127.0.0.1]/v1',
			'http://[::ffff:127.255.1.2]/v1'
		];

		for (const endpoint of endpoints) {
			assert.strictEqual(classifyProviderProcessingLocation(endpoint), 'local', endpoint);
		}
	});

	test('classifies non-loopback endpoints as remote', () => {
		const endpoints = [
			'https://api.openai.com/v1',
			'http://localhost.example.com/v1',
			'http://127.example.com/v1',
			'http://128.0.0.1/v1',
			'http://192.168.1.20:11434',
			'http://[::2]/v1'
		];

		for (const endpoint of endpoints) {
			assert.strictEqual(classifyProviderProcessingLocation(endpoint), 'remote', endpoint);
		}
	});

	test('classifies missing and invalid endpoints as unknown', () => {
		const endpoints = [undefined, '', '   ', 'not a url', 'localhost:11434', 'file:///tmp/model', 'ftp://localhost/model'];

		for (const endpoint of endpoints) {
			assert.strictEqual(classifyProviderProcessingLocation(endpoint), 'unknown', String(endpoint));
		}
	});

	test('classifies endpoint-less known cloud providers as external unless the endpoint is editable and blank', () => {
		assert.strictEqual(classifyProviderProcessingLocationForProvider(undefined, 'anthropic', false), 'remote');
		assert.strictEqual(classifyProviderProcessingLocationForProvider('', 'gemini', false), 'remote');
		assert.strictEqual(classifyProviderProcessingLocationForProvider('', 'openai', true), 'unknown');
		assert.strictEqual(classifyProviderProcessingLocationForProvider(undefined, 'customoai', false), 'unknown');
	});
});
