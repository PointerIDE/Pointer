/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { suite, test } from 'node:test';
import filter from 'gulp-filter';
import File from 'vinyl';
import { getCopilotExcludeFilter, prepareBuiltInCopilotRipgrepShim } from '../copilot.ts';

function applyFilter(relativePaths: string[], patterns: string[]): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const cwd = process.cwd();
		const result: string[] = [];
		const stream = filter(patterns);

		stream.on('data', (file: File) => result.push(file.relative.replaceAll('\\', '/')));
		stream.on('error', reject);
		stream.on('end', () => resolve(result));

		Readable.from(relativePaths.map(relativePath => new File({ cwd, base: cwd, path: path.join(cwd, relativePath) })))
			.pipe(stream);
	});
}

function writeFixture(root: string, relativePath: string): string {
	const file = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, relativePath);
	return file;
}

suite('Copilot packaging', () => {

	test('win32-x64 keeps the required MXC payload and excludes foreign platform binaries', async () => {
		const input = [
			'node_modules/@github/copilot/mxc-bin/arm64/_manifest/spdx_2.2/manifest.spdx.json',
			'node_modules/@github/copilot/mxc-bin/arm64/lxc-exec',
			'node_modules/@github/copilot/mxc-bin/arm64/wxc-exec.exe',
			'node_modules/@github/copilot/mxc-bin/x64/_manifest/spdx_2.2/manifest.spdx.json',
			'node_modules/@github/copilot/mxc-bin/x64/lxc-exec',
			'node_modules/@github/copilot/mxc-bin/x64/mxc-exec-mac',
			'node_modules/@github/copilot/mxc-bin/x64/winhttp-proxy-shim.exe',
			'node_modules/@github/copilot/mxc-bin/x64/wslcsdk.dll',
			'node_modules/@github/copilot/mxc-bin/x64/wxc-exec.exe',
			'node_modules/@github/copilot/mxc-bin/x64/wxc-windows-sandbox-daemon.exe',
			'node_modules/@github/copilot/app.js',
		];

		const result = await applyFilter(input, getCopilotExcludeFilter('win32', 'x64'));

		assert.deepStrictEqual(result, [
			'node_modules/@github/copilot/mxc-bin/x64/_manifest/spdx_2.2/manifest.spdx.json',
			'node_modules/@github/copilot/mxc-bin/x64/winhttp-proxy-shim.exe',
			'node_modules/@github/copilot/mxc-bin/x64/wslcsdk.dll',
			'node_modules/@github/copilot/mxc-bin/x64/wxc-exec.exe',
			'node_modules/@github/copilot/mxc-bin/x64/wxc-windows-sandbox-daemon.exe',
			'node_modules/@github/copilot/app.js',
		]);
	});

	test('does not prune MXC payloads for unverified targets', () => {
		for (const [platform, arch] of [['win32', 'arm64'], ['linux', 'x64'], ['darwin', 'x64']]) {
			assert.ok(getCopilotExcludeFilter(platform, arch).every(pattern => !pattern.includes('/mxc-bin/')));
		}
	});

	test('win32-x64 prunes the same MXC payload from the built-in Copilot extension', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pointer-copilot-package-'));
		const extensionDir = path.join(tempDir, 'extensions', 'copilot');
		const extensionCopilot = path.join(extensionDir, 'node_modules', '@github', 'copilot');
		const appNodeModules = path.join(tempDir, 'node_modules');

		try {
			writeFixture(extensionCopilot, 'mxc-bin/arm64/wxc-exec.exe');
			writeFixture(extensionCopilot, 'mxc-bin/x64/lxc-exec');
			writeFixture(extensionCopilot, 'mxc-bin/x64/mxc-exec-mac');
			const windowsExecutable = writeFixture(extensionCopilot, 'mxc-bin/x64/wxc-exec.exe');
			const windowsManifest = writeFixture(extensionCopilot, 'mxc-bin/x64/_manifest/spdx_2.2/manifest.spdx.json');
			fs.mkdirSync(path.join(extensionCopilot, 'sdk'), { recursive: true });
			writeFixture(appNodeModules, '@vscode/ripgrep/bin/rg.exe');

			prepareBuiltInCopilotRipgrepShim('win32', 'x64', extensionDir, appNodeModules);

			assert.ok(!fs.existsSync(path.join(extensionCopilot, 'mxc-bin', 'arm64')));
			assert.ok(!fs.existsSync(path.join(extensionCopilot, 'mxc-bin', 'x64', 'lxc-exec')));
			assert.ok(!fs.existsSync(path.join(extensionCopilot, 'mxc-bin', 'x64', 'mxc-exec-mac')));
			assert.ok(fs.existsSync(windowsExecutable));
			assert.ok(fs.existsSync(windowsManifest));
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
