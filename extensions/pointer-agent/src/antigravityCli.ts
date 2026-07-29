/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import * as vscode from 'vscode';

export class AntigravityCli {
	constructor(private readonly command: () => string, private readonly output: vscode.OutputChannel) { }

	async run(prompt: string, cwd: string, model: string | undefined, onChunk: (text: string) => void, token: vscode.CancellationToken): Promise<void> {
		const executable = this.command().trim() || 'agy';
		const args = ['-p', prompt];
		if (model) {
			args.push('--model', model);
		}
		await new Promise<void>((resolve, reject) => {
			const child = spawn(executable, args, { cwd, windowsHide: true });
			const cancellation = token.onCancellationRequested(() => child.kill());
			let stderr = '';
			child.stdout.on('data', data => onChunk(stripAnsi(data.toString())));
			child.stderr.on('data', data => {
				const text = stripAnsi(data.toString());
				stderr += text;
				this.output.append(text);
			});
			child.on('error', error => {
				cancellation.dispose();
				reject(error);
			});
			child.on('exit', code => {
				cancellation.dispose();
				if (code === 0 || token.isCancellationRequested) {
					resolve();
				} else {
					reject(new Error(stderr.trim() || `Antigravity exited with code ${code}.`));
				}
			});
		});
	}

	openLoginTerminal(): void {
		const terminal = vscode.window.createTerminal({ name: 'Connect Antigravity' });
		terminal.show();
		terminal.sendText(this.command().trim() || 'agy');
	}

	async listModels(): Promise<string[]> {
		const executable = this.command().trim() || 'agy';
		return new Promise<string[]>((resolve, reject) => {
			const child = spawn(executable, ['models'], { windowsHide: true });
			let stdout = '';
			let stderr = '';
			child.stdout.on('data', data => stdout += stripAnsi(data.toString()));
			child.stderr.on('data', data => stderr += stripAnsi(data.toString()));
			child.on('error', reject);
			child.on('exit', code => {
				if (code !== 0) {
					reject(new Error(stderr.trim() || `Antigravity exited with code ${code}.`));
					return;
				}
				resolve(stdout.split(/\r?\n/).map(line => line.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean));
			});
		});
	}
}

function stripAnsi(value: string): string {
	return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}
