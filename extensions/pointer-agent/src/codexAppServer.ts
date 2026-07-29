/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { createInterface, Interface } from 'readline';
import * as vscode from 'vscode';

export interface CodexAccount {
	type: 'apiKey' | 'chatgpt' | 'amazonBedrock';
	email?: string | null;
	planType?: string;
}

export interface CodexAccountState {
	account: CodexAccount | null;
	requiresOpenaiAuth: boolean;
}

export interface CodexModel {
	id: string;
	displayName: string;
	isDefault?: boolean;
	hidden?: boolean;
}

type JsonObject = Record<string, unknown>;
type NotificationListener = (params: JsonObject) => void;
type ServerRequestListener = (method: string, params: JsonObject) => Promise<JsonObject>;

export class CodexAppServer implements vscode.Disposable {
	private process: ChildProcessWithoutNullStreams | undefined;
	private lines: Interface | undefined;
	private nextId = 1;
	private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
	private readonly notificationListeners = new Set<NotificationListener>();
	private serverRequestListener: ServerRequestListener | undefined;
	private startPromise: Promise<void> | undefined;

	constructor(
		private readonly command: () => string,
		private readonly args: () => string[],
		private readonly output: vscode.OutputChannel
	) { }

	onNotification(listener: NotificationListener): vscode.Disposable {
		this.notificationListeners.add(listener);
		return { dispose: () => this.notificationListeners.delete(listener) };
	}

	setServerRequestListener(listener: ServerRequestListener | undefined): void {
		this.serverRequestListener = listener;
	}

	async accountState(): Promise<CodexAccountState> {
		return this.request<CodexAccountState>('account/read', { refreshToken: false });
	}

	async account(): Promise<CodexAccount | null> {
		const response = await this.accountState();
		return response.account;
	}

	async loginWithChatGPT(): Promise<{ loginId: string; authUrl: string }> {
		return this.request('account/login/start', {
			type: 'chatgpt',
			codexStreamlinedLogin: true,
			useHostedLoginSuccessPage: true,
			appBrand: 'codex'
		});
	}

	async loginWithApiKey(apiKey: string): Promise<void> {
		await this.request('account/login/start', { type: 'apiKey', apiKey });
	}

	async logout(): Promise<void> {
		await this.request('account/logout', undefined);
	}

	async listModels(): Promise<CodexModel[]> {
		const response = await this.request<{ data: CodexModel[] }>('model/list', { limit: 100, includeHidden: false });
		return response.data;
	}

	async startThread(cwd: string, model: string | undefined, modelProvider?: string): Promise<string> {
		const response = await this.request<{ thread: { id: string } }>('thread/start', {
			cwd,
			model: model || null,
			modelProvider: modelProvider || null,
			approvalPolicy: 'on-request',
			sandbox: 'workspace-write',
			serviceName: 'pointer_agent'
		});
		return response.thread.id;
	}

	async startTurn(threadId: string, prompt: string, effort: string): Promise<{ turn: { id: string } }> {
		return this.request('turn/start', {
			threadId,
			input: [{ type: 'text', text: prompt, text_elements: [] }],
			effort
		});
	}

	async interrupt(threadId: string, turnId: string): Promise<void> {
		await this.request('turn/interrupt', { threadId, turnId });
	}

	async request<T>(method: string, params: JsonObject | undefined): Promise<T> {
		await this.start();
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: value => resolve(value as T), reject });
			this.write({ method, id, params });
		});
	}

	private async start(): Promise<void> {
		if (!this.startPromise) {
			this.startPromise = this.doStart().catch(error => {
				this.startPromise = undefined;
				throw error;
			});
		}
		return this.startPromise;
	}

	private async doStart(): Promise<void> {
		const executable = this.command().trim() || 'codex';
		this.output.appendLine(`Starting Codex app server: ${executable}`);
		this.process = spawn(executable, [...this.args(), 'app-server', '--stdio'], { windowsHide: true });
		this.process.stderr.on('data', data => this.output.append(data.toString()));
		this.process.on('error', error => this.failAll(error));
		this.process.on('exit', (code, signal) => {
			this.failAll(new Error(`Codex app server stopped (${code ?? signal ?? 'unknown'}).`));
			this.process = undefined;
			this.startPromise = undefined;
		});
		this.lines = createInterface({ input: this.process.stdout });
		this.lines.on('line', line => this.handleLine(line));
		await this.rawInitialize();
	}

	private rawInitialize(): Promise<void> {
		const id = this.nextId++;
		return new Promise<void>((resolve, reject) => {
			this.pending.set(id, {
				resolve: () => {
					this.write({ method: 'initialized', params: {} });
					resolve();
				},
				reject
			});
			this.write({
				method: 'initialize',
				id,
				params: {
					clientInfo: { name: 'pointer_agent', title: 'Pointer Agent', version: '0.1.0' },
					capabilities: { experimentalApi: false }
				}
			});
		});
	}

	private handleLine(line: string): void {
		if (!line.trim()) {
			return;
		}
		let message: JsonObject;
		try {
			message = JSON.parse(line) as JsonObject;
		} catch {
			this.output.appendLine(`Codex protocol: ${line}`);
			return;
		}

		if (typeof message.id === 'number' && !message.method) {
			const pending = this.pending.get(message.id);
			if (!pending) {
				return;
			}
			this.pending.delete(message.id);
			if (message.error && typeof message.error === 'object') {
				const error = message.error as { message?: string };
				pending.reject(new Error(error.message || 'Codex request failed.'));
			} else {
				pending.resolve(message.result);
			}
			return;
		}

		if (typeof message.method !== 'string') {
			return;
		}
		const params = (message.params && typeof message.params === 'object' ? message.params : {}) as JsonObject;
		if (typeof message.id === 'number') {
			void this.handleServerRequest(message.id, message.method, params);
			return;
		}
		for (const listener of this.notificationListeners) {
			listener({ ...params, method: message.method });
		}
	}

	private async handleServerRequest(id: number, method: string, params: JsonObject): Promise<void> {
		try {
			const result = this.serverRequestListener ? await this.serverRequestListener(method, params) : { decision: 'decline' };
			this.write({ id, result });
		} catch (error) {
			this.write({ id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
		}
	}

	private write(message: JsonObject): void {
		if (!this.process?.stdin.writable) {
			throw new Error('Codex app server is not available.');
		}
		this.process.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private failAll(error: Error): void {
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
	}

	dispose(): void {
		this.lines?.close();
		this.process?.kill();
		this.process = undefined;
		this.startPromise = undefined;
		this.failAll(new Error('Codex app server disposed.'));
	}
}
