/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { resolveCustomOAIUrl } from '../customOAIProvider';

describe('CustomOAIBYOKModelProvider', () => {
	it('composes an explicit API path with the configured base URL', () => {
		expect(resolveCustomOAIUrl('model', 'https://example.com/v1', '/responses')).toBe('https://example.com/v1/responses');
		expect(resolveCustomOAIUrl('model', 'https://example.com/', 'v1/chat/completions')).toBe('https://example.com/v1/chat/completions');
	});

	it('keeps existing endpoint composition when no API path is configured', () => {
		expect(resolveCustomOAIUrl('model', 'https://example.com/v1')).toBe('https://example.com/v1/chat/completions');
		expect(resolveCustomOAIUrl('model', 'https://example.com/responses')).toBe('https://example.com/responses');
	});
});
