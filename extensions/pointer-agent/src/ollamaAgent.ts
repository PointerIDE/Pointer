/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

interface OllamaMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	tool_name?: string;
	tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

interface OllamaResponse {
	message: OllamaMessage;
}

const tools = [
	tool('list_files', 'List files and folders inside the workspace.', { path: stringProperty('Relative directory path') }, ['path']),
	tool('read_file', 'Read a UTF-8 text file inside the workspace.', { path: stringProperty('Relative file path') }, ['path']),
	tool('write_file', 'Write a UTF-8 text file inside the workspace after user approval.', { path: stringProperty('Relative file path'), content: stringProperty('Complete file content') }, ['path', 'content']),
	tool('run_command', 'Run a shell command in the workspace after user approval.', { command: stringProperty('Shell command') }, ['command'])
];

export class OllamaAgent {
	private readonly conversations = new Map<string, OllamaMessage[]>();

	async run(sessionId: string, prompt: string, cwd: string, model: string, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
		const history = this.conversations.get(sessionId) ?? [{
			role: 'system',
			content: 'You are Pointer Agent, a concise coding agent. Inspect the workspace before changing it. Use tools when needed. Never claim a change succeeded until the tool confirms it.'
		} satisfies OllamaMessage];
		history.push({ role: 'user', content: prompt });

		for (let step = 0; step < 12; step++) {
			if (token.isCancellationRequested) {
				return;
			}
			const controller = new AbortController();
			const cancellation = token.onCancellationRequested(() => controller.abort());
			let response: Response;
			try {
				response = await fetch('http://127.0.0.1:11434/api/chat', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ model, messages: history, tools, stream: false, keep_alive: '10m' }),
					signal: controller.signal
				});
			} finally {
				cancellation.dispose();
			}
			if (!response.ok) {
				throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
			}
			const body = await response.json() as OllamaResponse;
			const message = body.message;
			history.push(message);
			if (message.content) {
				stream.markdown(message.content);
			}
			const calls = message.tool_calls ?? [];
			if (!calls.length) {
				this.conversations.set(sessionId, history.slice(-40));
				return;
			}
			for (const call of calls) {
				stream.progress(friendlyToolName(call.function.name));
				const result = await this.executeTool(call.function.name, call.function.arguments, cwd);
				history.push({ role: 'tool', tool_name: call.function.name, content: result });
			}
		}
		throw new Error('Local agent stopped after 12 tool steps. Refine the request and try again.');
	}

	private async executeTool(name: string, args: Record<string, unknown>, cwd: string): Promise<string> {
		if (name === 'list_files') {
			const target = workspacePath(cwd, requiredString(args.path, 'path'));
			const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(target));
			return entries.slice(0, 500).map(([entry, type]) => `${type === vscode.FileType.Directory ? 'directory' : 'file'}\t${entry}`).join('\n');
		}
		if (name === 'read_file') {
			const target = workspacePath(cwd, requiredString(args.path, 'path'));
			const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(target));
			return new TextDecoder().decode(bytes).slice(0, 120_000);
		}
		if (name === 'write_file') {
			const relative = requiredString(args.path, 'path');
			const content = requiredString(args.content, 'content');
			const target = workspacePath(cwd, relative);
			const choice = await vscode.window.showWarningMessage(`Pointer Agent wants to write ${relative}`, { modal: true }, 'Allow', 'Deny');
			if (choice !== 'Allow') {
				return 'User denied the file change.';
			}
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target)));
			await vscode.workspace.fs.writeFile(vscode.Uri.file(target), new TextEncoder().encode(content));
			return `Wrote ${relative}.`;
		}
		if (name === 'run_command') {
			const command = requiredString(args.command, 'command');
			const choice = await vscode.window.showWarningMessage(`Pointer Agent wants to run:\n${command}`, { modal: true }, 'Allow', 'Deny');
			if (choice !== 'Allow') {
				return 'User denied the command.';
			}
			return runCommand(command, cwd);
		}
		return `Unknown tool: ${name}`;
	}
}

function workspacePath(cwd: string, relative: string): string {
	const root = path.resolve(cwd);
	const target = path.resolve(root, relative);
	if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
		throw new Error('Tool path must stay inside the workspace.');
	}
	return target;
}

function requiredString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`Tool argument '${name}' must be a non-empty string.`);
	}
	return value;
}

function runCommand(command: string, cwd: string): Promise<string> {
	return new Promise(resolve => {
		exec(command, { cwd, windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
			const output = `${stdout}${stderr}`.slice(-120_000);
			if (error) {
				resolve(`Command failed (${error.code ?? 'unknown'}).\n${output}`);
			} else {
				resolve(output || 'Command completed successfully.');
			}
		});
	});
}

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
	return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

function stringProperty(description: string): Record<string, string> {
	return { type: 'string', description };
}

function friendlyToolName(name: string): string {
	switch (name) {
		case 'list_files': return 'Listing files';
		case 'read_file': return 'Reading file';
		case 'write_file': return 'Applying changes';
		case 'run_command': return 'Running command';
		default: return 'Using tool';
	}
}
