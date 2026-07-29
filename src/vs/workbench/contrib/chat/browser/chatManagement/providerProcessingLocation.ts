/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Coarse processing location derived syntactically from a provider endpoint. */
export type ProviderProcessingLocation = 'local' | 'remote' | 'unknown';

const knownExternalProviderVendors = new Set(['anthropic', 'azure', 'copilot', 'gemini', 'groq', 'openai', 'openrouter', 'xai', 'zai']);

/**
 * Syntactically classifies an HTTP(S) provider endpoint as loopback-local or remote.
 * This function performs no DNS lookup. Unsupported schemes and malformed or hostless URLs are unknown.
 */
export function classifyProviderProcessingLocation(endpoint: string | undefined): ProviderProcessingLocation {
	const value = endpoint?.trim();
	if (!value) {
		return 'unknown';
	}

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return 'unknown';
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return 'unknown';
	}

	const hostname = url.hostname.toLowerCase();
	if (!hostname) {
		return 'unknown';
	}

	const normalizedHostname = hostname
		.replace(/^\[|\]$/g, '')
		.replace(/\.$/, '');
	if (normalizedHostname === 'localhost' || normalizedHostname.endsWith('.localhost')) {
		return 'local';
	}
	if (normalizedHostname === '::1'
		|| isLoopbackIpv4Address(normalizedHostname)
		|| isLoopbackIpv4MappedIpv6Address(normalizedHostname)) {
		return 'local';
	}

	return 'remote';
}

/**
 * Classifies a provider while distinguishing an intentionally blank editable endpoint from
 * endpoint-less cloud providers whose network location is known from their provider contract.
 */
export function classifyProviderProcessingLocationForProvider(endpoint: string | undefined, vendor: string, hasEditableEndpoint: boolean): ProviderProcessingLocation {
	if (endpoint?.trim()) {
		return classifyProviderProcessingLocation(endpoint);
	}
	if (hasEditableEndpoint) {
		return 'unknown';
	}
	return knownExternalProviderVendors.has(vendor) ? 'remote' : 'unknown';
}

function isLoopbackIpv4Address(hostname: string): boolean {
	const octets = hostname.split('.');
	return octets.length === 4
		&& octets[0] === '127'
		&& octets.every(octet => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

function isLoopbackIpv4MappedIpv6Address(hostname: string): boolean {
	if (!hostname.startsWith('::ffff:')) {
		return false;
	}

	const hextets = hostname.slice('::ffff:'.length).split(':');
	if (hextets.length !== 2 || !hextets.every(hextet => /^[0-9a-f]{1,4}$/.test(hextet))) {
		return false;
	}

	const firstHextet = hextets[0];
	return firstHextet !== undefined && (Number.parseInt(firstHextet, 16) >>> 8) === 0x7f;
}
