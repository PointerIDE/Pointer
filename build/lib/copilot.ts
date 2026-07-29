/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

/**
 * The platforms that @github/copilot ships platform-specific packages for.
 * These are the `@github/copilot-{platform}` optional dependency packages.
 */
export const copilotPlatforms = [
	'darwin-arm64', 'darwin-x64',
	'linux-arm64', 'linux-x64',
	'linuxmusl-arm64', 'linuxmusl-x64',
	'win32-arm64', 'win32-x64',
];

const clipboardNativePlatforms = [
	'darwin-arm64', 'darwin-x64',
	'linux-arm64-gnu', 'linux-x64-gnu',
	'win32-arm64-msvc', 'win32-x64-msvc',
];

const foundryNativePlatforms = [
	'darwin-arm64',
	'linux-x64',
	'win32-arm64', 'win32-x64',
];

const pvrecorderNativePlatforms = [
	'linux/x86_64',
	'mac/arm64', 'mac/x86_64',
	'windows/amd64', 'windows/arm64',
];

const anthropicAudioCapturePlatforms = [
	'arm64-darwin', 'arm64-linux', 'arm64-win32',
	'x64-darwin', 'x64-linux', 'x64-win32',
];

/**
 * Converts Pointer build platform/arch to the values that Node.js reports
 * at runtime via `process.platform` and `process.arch`.
 *
 * The copilot SDK's `loadNativeModule` looks up native binaries under
 * `prebuilds/${process.platform}-${process.arch}/`, so the directory names
 * must match these runtime values exactly.
 */
function toNodePlatformArch(platform: string, arch: string): { nodePlatform: string; nodeArch: string } {
	// alpine is musl-linux; Node still reports process.platform === 'linux'
	let nodePlatform = platform === 'alpine' ? 'linux' : platform;
	let nodeArch = arch;

	if (arch === 'armhf') {
		// Pointer build uses 'armhf'; Node reports process.arch === 'arm'
		nodeArch = 'arm';
	} else if (arch === 'alpine') {
		// Legacy: { platform: 'linux', arch: 'alpine' } means alpine-x64
		nodePlatform = 'linux';
		nodeArch = 'x64';
	}

	return { nodePlatform, nodeArch };
}

function getClipboardNativePlatform(nodePlatform: string, nodeArch: string): string | undefined {
	if (nodePlatform === 'win32') {
		return `win32-${nodeArch}-msvc`;
	}
	if (nodePlatform === 'linux') {
		return `linux-${nodeArch}-gnu`;
	}
	if (nodePlatform === 'darwin') {
		return `darwin-${nodeArch}`;
	}

	return undefined;
}

function getFoundryNativePlatform(nodePlatform: string, nodeArch: string): string | undefined {
	const platformArch = `${nodePlatform}-${nodeArch}`;
	return foundryNativePlatforms.includes(platformArch) ? platformArch : undefined;
}

function getPvrecorderNativePlatform(nodePlatform: string, nodeArch: string): string | undefined {
	if (nodePlatform === 'win32') {
		return nodeArch === 'arm64' ? 'windows/arm64' : 'windows/amd64';
	}
	if (nodePlatform === 'darwin') {
		return nodeArch === 'arm64' ? 'mac/arm64' : 'mac/x86_64';
	}
	if (nodePlatform === 'linux' && nodeArch === 'x64') {
		return 'linux/x86_64';
	}

	return undefined;
}

function getAnthropicAudioCapturePlatform(nodePlatform: string, nodeArch: string): string | undefined {
	const platformArch = `${nodeArch}-${nodePlatform}`;
	return anthropicAudioCapturePlatforms.includes(platformArch) ? platformArch : undefined;
}

function getMxcBinExcludes(nodePlatform: string, nodeArch: string): string[] {
	// Copilot selects this directory from os.arch(), then selects the executable
	// for os.platform(). Keep this conservative until other targets are verified.
	if (nodePlatform !== 'win32' || nodeArch !== 'x64') {
		return [];
	}

	return [
		'!**/node_modules/@github/copilot/mxc-bin/arm64/**',
		'!**/node_modules/@github/copilot/mxc-bin/x64/lxc-exec',
		'!**/node_modules/@github/copilot/mxc-bin/x64/mxc-exec-mac',
	];
}

/**
 * Returns a glob filter that strips @github/copilot platform packages
 * for architectures other than the build target.
 *
 * For platforms the copilot SDK doesn't natively support (e.g. alpine, armhf),
 * ALL platform packages are stripped - that's fine because the copilot CLI SDK
 * resolves `node-pty` from the embedder (Pointer) first via `hostRequire`,
 * falling back to its bundled copy only if the embedder can't provide it.
 */
export function getCopilotExcludeFilter(platform: string, arch: string): string[] {
	const { nodePlatform, nodeArch } = toNodePlatformArch(platform, arch);
	const targetPlatformArch = `${nodePlatform}-${nodeArch}`;
	const nonTargetPlatforms = copilotPlatforms.filter(p => p !== targetPlatformArch);
	const targetClipboardPlatform = getClipboardNativePlatform(nodePlatform, nodeArch);
	const targetFoundryPlatform = getFoundryNativePlatform(nodePlatform, nodeArch);
	const targetPvrecorderPlatform = getPvrecorderNativePlatform(nodePlatform, nodeArch);

	// Strip wrong-architecture @github/copilot-{platform} packages.
	// All copilot prebuilds are stripped by .moduleignore; the copilot CLI SDK
	// resolves `node-pty` from Pointer's own node_modules via `hostRequire`.
	const excludes = nonTargetPlatforms.map(p => `!**/node_modules/@github/copilot-${p}/**`);
	excludes.push(...clipboardNativePlatforms
		.filter(p => p !== targetClipboardPlatform)
		.flatMap(p => [
			`!**/node_modules/@github/copilot/clipboard/node_modules/@teddyzhu/clipboard/clipboard.${p}.node`,
			`!**/node_modules/@github/copilot/clipboard/node_modules/@teddyzhu/clipboard-${p}/**`
		]));
	excludes.push(...foundryNativePlatforms
		.filter(p => p !== targetFoundryPlatform)
		.map(p => `!**/node_modules/@github/copilot/foundry-local-sdk/node_modules/foundry-local-sdk/prebuilds/${p}/**`));
	excludes.push(...pvrecorderNativePlatforms
		.filter(p => p !== targetPvrecorderPlatform)
		.map(p => `!**/node_modules/@github/copilot/pvrecorder/node_modules/@picovoice/pvrecorder-node/lib/${p}/**`));
	excludes.push(...getMxcBinExcludes(nodePlatform, nodeArch));

	return ['**', ...excludes];
}

function removeIfExists(base: string, ...segments: string[]): void {
	fs.rmSync(path.join(base, ...segments), { recursive: true, force: true });
}

function pruneBuiltInCopilotNativePayloads(platform: string, arch: string, extensionNodeModules: string): void {
	const { nodePlatform, nodeArch } = toNodePlatformArch(platform, arch);
	const targetPlatformArch = `${nodePlatform}-${nodeArch}`;
	const targetClipboardPlatform = getClipboardNativePlatform(nodePlatform, nodeArch);
	const targetFoundryPlatform = getFoundryNativePlatform(nodePlatform, nodeArch);
	const targetPvrecorderPlatform = getPvrecorderNativePlatform(nodePlatform, nodeArch);
	const targetAnthropicAudioCapturePlatform = getAnthropicAudioCapturePlatform(nodePlatform, nodeArch);

	for (const platform of copilotPlatforms.filter(p => p !== targetPlatformArch)) {
		removeIfExists(extensionNodeModules, '@github', `copilot-${platform}`);
		removeIfExists(extensionNodeModules, '@github', 'copilot', 'prebuilds', platform);
		removeIfExists(extensionNodeModules, '@github', 'copilot', 'sdk', 'prebuilds', platform);
	}

	for (const platform of clipboardNativePlatforms.filter(p => p !== targetClipboardPlatform)) {
		removeIfExists(extensionNodeModules, '@github', 'copilot', 'clipboard', 'node_modules', '@teddyzhu', 'clipboard', `clipboard.${platform}.node`);
		removeIfExists(extensionNodeModules, '@github', 'copilot', 'clipboard', 'node_modules', '@teddyzhu', `clipboard-${platform}`);
	}

	for (const platform of foundryNativePlatforms.filter(p => p !== targetFoundryPlatform)) {
		removeIfExists(extensionNodeModules, '@github', 'copilot', 'foundry-local-sdk', 'node_modules', 'foundry-local-sdk', 'prebuilds', platform);
	}

	for (const platform of pvrecorderNativePlatforms.filter(p => p !== targetPvrecorderPlatform)) {
		removeIfExists(extensionNodeModules, '@github', 'copilot', 'pvrecorder', 'node_modules', '@picovoice', 'pvrecorder-node', 'lib', ...platform.split('/'));
	}

	for (const platform of anthropicAudioCapturePlatforms.filter(p => p !== targetAnthropicAudioCapturePlatform)) {
		removeIfExists(extensionNodeModules, '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'audio-capture', platform);
	}

	if (nodePlatform === 'win32' && nodeArch === 'x64') {
		removeIfExists(extensionNodeModules, '@github', 'copilot', 'mxc-bin', 'arm64');
		removeIfExists(extensionNodeModules, '@github', 'copilot', 'mxc-bin', 'x64', 'lxc-exec');
		removeIfExists(extensionNodeModules, '@github', 'copilot', 'mxc-bin', 'x64', 'mxc-exec-mac');
	}
}

/**
 * Materializes the copilot CLI ripgrep shim directly inside the built-in copilot extension.
 *
 * This is used when copilot is shipped as a built-in extension so startup does
 * not need to create the shim at runtime. The destination layout matches the
 * runtime shim logic in the copilot extension:
 * - ripgrep:  node_modules/@github/copilot/sdk/ripgrep/bin/{platform-arch}
 * - marker:   node_modules/@github/copilot/shims.txt
 *
 * Note: `node-pty` is no longer shimmed. The copilot CLI SDK resolves
 * `node-pty` from the embedder (Pointer) via `hostRequire` and falls back to
 * its bundled copy only if that fails.
 *
 * Failures throw to fail the build because built-in packaging must guarantee
 * this artifact is present.
 */
export function prepareBuiltInCopilotRipgrepShim(platform: string, arch: string, builtInCopilotExtensionDir: string, appNodeModulesDir: string): void {
	const { nodePlatform, nodeArch } = toNodePlatformArch(platform, arch);
	const platformArch = `${nodePlatform}-${nodeArch}`;

	const extensionNodeModules = path.join(builtInCopilotExtensionDir, 'node_modules');
	pruneBuiltInCopilotNativePayloads(platform, arch, extensionNodeModules);

	const copilotBase = path.join(extensionNodeModules, '@github', 'copilot');
	const copilotSdkBase = path.join(copilotBase, 'sdk');
	if (!fs.existsSync(copilotSdkBase)) {
		throw new Error(`[prepareBuiltInCopilotRipgrepShim] Copilot SDK directory not found at ${copilotSdkBase}`);
	}

	const ripgrepSource = path.join(appNodeModulesDir, '@vscode', 'ripgrep', 'bin');
	if (!fs.existsSync(ripgrepSource)) {
		throw new Error(`[prepareBuiltInCopilotRipgrepShim] ripgrep source not found at ${ripgrepSource}`);
	}

	const ripgrepDest = path.join(copilotSdkBase, 'ripgrep', 'bin', platformArch);
	const shimMarkerPath = path.join(copilotBase, 'shims.txt');

	try {
		fs.mkdirSync(ripgrepDest, { recursive: true });
		fs.cpSync(ripgrepSource, ripgrepDest, { recursive: true });

		fs.writeFileSync(shimMarkerPath, 'Shims created successfully');
		console.log(`[prepareBuiltInCopilotRipgrepShim] Materialized ripgrep shim for ${platformArch} in ${builtInCopilotExtensionDir}`);
	} catch (err) {
		throw new Error(`[prepareBuiltInCopilotRipgrepShim] Failed to materialize ripgrep shim for ${platformArch}: ${err}`);
	}
}
