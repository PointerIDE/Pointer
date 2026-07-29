/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AntigravityCli } from './antigravityCli';
import { CodexAccount, CodexAppServer } from './codexAppServer';
import { OllamaAgent } from './ollamaAgent';
import { PointerLanguageModelAgent, PointerProviderId, pointerProviders, providerLabel } from './pointerKernel';

const SAFE_PROVIDER_KNOWLEDGE = [
	'Pointer model providers are managed in Settings > AI & Models and in the user-scoped chatLanguageModels.json file.',
	'Pointer Kernel discovers configured language models through the editor model registry and discovers coding-plugin and MCP tools through the editor tool registry.',
	'Use the Pointer provider UI or workbench.action.openLanguageModelsJson when configuration changes are required.',
	'ChatGPT subscription login, OpenAI Platform API billing, Google authentication, and local runtimes are separate connection types; never reuse credentials across them.',
	'MCP servers and their authorization are managed by Pointer. Invoke registered tools through the editor so confirmations and audit UI remain intact.',
	'Never request, print, copy, or persist API keys in chat, workspace files, logs, or shell history. Authentication belongs in the provider credential flow.',
	'Prefer an already connected provider and registered model. Ask before changing a default model or adding a network endpoint.',
].join(' ');

interface CodexNotification extends Record<string, unknown> {
	method?: string;
	threadId?: string;
	delta?: string;
	turn?: { id?: string; status?: string; error?: { message?: string } };
}

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Pointer Agent');
	const codexCommand = () => vscode.workspace.getConfiguration('pointer.agent.codex').get<string>('command', 'codex');
	const cloud = new CodexAppServer(codexCommand, () => [], output);
	const local = new OllamaAgent();
	const kernel = new PointerLanguageModelAgent();
	const antigravity = new AntigravityCli(
		() => vscode.workspace.getConfiguration('pointer.agent.antigravity').get<string>('command', 'agy'),
		output
	);
	cloud.setServerRequestListener(handleApproval);
	context.subscriptions.push(output, cloud);

	const threads = new Map<string, { threadId: string; cwd: string; provider: PointerProviderId; model?: string }>();
	const participant = vscode.chat.createChatParticipant('pointer.agent', async (request, _chatContext, stream, token) => {
		const provider = getProvider();
		try {
			if (request.command === 'setup') {
				stream.markdown('Pointer Kernel uses every model registered in **Settings > AI & Models**, including models from installed extensions and local runtimes. Credentials stay in each provider\'s authentication flow and are never written into the workspace.\n\n');
				stream.button({ command: 'pointer.agent.openModelProviders', title: 'Open AI & Models' });
				return { metadata: { provider, safeKnowledge: true } };
			}
			if (request.command === 'provider') {
				await selectProvider();
				stream.markdown(`Pointer Agent now uses **${providerLabel(getProvider())}**.`);
				return;
			}
			if (request.command === 'model') {
				await selectModel(cloud, antigravity);
				stream.markdown('Model selection updated.');
				return;
			}
			if (request.command === 'connect') {
				await connectProvider(provider, cloud, antigravity);
				return;
			}
			const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
			const sessionId = (request as vscode.ChatRequest & { sessionId?: string }).sessionId ?? 'pointer-default';
			if (provider === 'pointer') {
				const configuredModelId = vscode.workspace.getConfiguration('pointer.agent.models').get<string>('model') || undefined;
				stream.progress('Pointer Kernel is working');
				const result = await kernel.run({
					sessionId,
					prompt: withSafeProviderKnowledge(request.prompt),
					request,
					configuredModelId,
					stream,
					token
				});
				return { metadata: { provider, model: result.model.id, vendor: result.model.vendor, toolCount: result.toolCount } };
			}
			if (provider === 'antigravity') {
				const model = vscode.workspace.getConfiguration('pointer.agent.antigravity').get<string>('model') || undefined;
				stream.progress('Antigravity is working');
				await antigravity.run(withSafeProviderKnowledge(request.prompt), cwd, model, text => stream.markdown(text), token);
				return { metadata: { provider } };
			}
			if (provider === 'local') {
				const model = vscode.workspace.getConfiguration('pointer.agent.local').get<string>('model') || undefined;
				if (!model) {
					stream.markdown('Choose an installed Ollama model first.\n\n');
					stream.button({ command: 'pointer.agent.selectModel', title: 'Choose local model' });
					return { metadata: { provider, modelRequired: true } };
				}
				stream.progress('Local agent is working');
				await local.run(sessionId, withSafeProviderKnowledge(request.prompt), cwd, model, stream, token);
				return { metadata: { provider, model } };
			}

			const server = cloud;
			if (provider === 'codex') {
				const state = await cloud.accountState();
				if (state.requiresOpenaiAuth && !state.account) {
					stream.markdown('Connect Codex to start using Pointer Agent.\n\n');
					stream.button({ command: 'pointer.agent.signInChatGPT', title: 'Connect ChatGPT' });
					stream.button({ command: 'pointer.agent.useApiKey', title: 'Use API key' });
					return { metadata: { provider, authRequired: true } };
				}
			}

			const model = vscode.workspace.getConfiguration('pointer.agent.codex').get<string>('model') || undefined;

			const key = `${provider}:${sessionId}`;
			const existing = threads.get(key);
			const sameThread = existing?.cwd === cwd && existing.model === model;
			const threadId = sameThread
				? existing.threadId
				: await server.startThread(cwd, model);
			threads.set(key, { threadId, cwd, provider, model });
			const effort = vscode.workspace.getConfiguration('pointer.agent.codex').get<string>('reasoningEffort', 'medium');
			await runCodexTurn(server, threadId, withSafeProviderKnowledge(request.prompt), effort, stream, token);
			return { metadata: { provider, threadId } };
		} catch (error) {
			const message = toMessage(error);
			output.appendLine(message);
			if (provider === 'antigravity' && /ENOENT|not recognized|not found/i.test(message)) {
				stream.markdown('Google Antigravity CLI is not installed yet.\n\n');
				stream.button({ command: 'pointer.agent.connectAntigravity', title: 'Set up Antigravity' });
			} else {
				stream.markdown(`Pointer Agent could not complete this request: ${message}`);
			}
			return { errorDetails: { message } };
		}
	});
	participant.iconPath = new vscode.ThemeIcon('cursor');
	participant.helpTextPrefix = new vscode.MarkdownString('Pointer Agent runs configured APIs, installed AI extensions, Codex, Google Antigravity, and local models through one Pointer Kernel.');
	context.subscriptions.push(participant);

	context.subscriptions.push(
		vscode.commands.registerCommand('pointer.agent.signInChatGPT', () => signInWithChatGPT(cloud)),
		vscode.commands.registerCommand('pointer.agent.useApiKey', () => useApiKey(cloud)),
		vscode.commands.registerCommand('pointer.agent.signOut', () => signOut(cloud)),
		vscode.commands.registerCommand('pointer.agent.selectProvider', selectProvider),
		vscode.commands.registerCommand('pointer.agent.selectModel', () => selectModel(cloud, antigravity)),
		vscode.commands.registerCommand('pointer.agent.connectAntigravity', () => connectAntigravity(antigravity)),
		vscode.commands.registerCommand('pointer.agent.usePointerKernel', async () => {
			await vscode.workspace.getConfiguration('pointer.agent').update('provider', 'pointer', vscode.ConfigurationTarget.Global);
			void vscode.window.showInformationMessage('Pointer Kernel now uses the model selected in chat.');
		}),
		vscode.commands.registerCommand('pointer.agent.openModelProviders', () => vscode.commands.executeCommand('workbench.action.openLanguageModelsJson'))
	);
}

function withSafeProviderKnowledge(prompt: string): string {
	return `<pointer_provider_knowledge>${SAFE_PROVIDER_KNOWLEDGE}</pointer_provider_knowledge>\n\n${prompt}`;
}

async function runCodexTurn(server: CodexAppServer, threadId: string, prompt: string, effort: string, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
	let activeTurnId: string | undefined;
	let completed = false;
	let failure: Error | undefined;
	let resolveCompletion: (() => void) | undefined;
	const completion = new Promise<void>(resolve => resolveCompletion = resolve);
	const notifications = server.onNotification(raw => {
		const event = raw as CodexNotification;
		if (event.threadId !== threadId) {
			return;
		}
		if (event.method === 'turn/started' && typeof event.turn?.id === 'string') {
			activeTurnId = event.turn.id;
		} else if (event.method === 'item/agentMessage/delta' && typeof event.delta === 'string') {
			stream.markdown(event.delta);
		} else if (event.method === 'item/commandExecution/outputDelta') {
			stream.progress('Running command');
		} else if (event.method === 'item/fileChange/outputDelta') {
			stream.progress('Applying changes');
		} else if (event.method === 'turn/completed') {
			completed = true;
			if (event.turn?.status === 'failed') {
				failure = new Error(event.turn.error?.message || 'Agent turn failed.');
			}
			resolveCompletion?.();
		}
	});
	const cancellation = token.onCancellationRequested(() => {
		if (activeTurnId && !completed) {
			void server.interrupt(threadId, activeTurnId);
		}
		resolveCompletion?.();
	});
	try {
		stream.progress('Agent is working');
		const started = await server.startTurn(threadId, prompt, effort);
		activeTurnId = started.turn.id;
		await completion;
		if (failure) {
			throw failure;
		}
	} finally {
		notifications.dispose();
		cancellation.dispose();
	}
}

function getProvider(): PointerProviderId {
	return vscode.workspace.getConfiguration('pointer.agent').get<PointerProviderId>('provider', 'pointer');
}

async function selectProvider(): Promise<void> {
	const selected = await vscode.window.showQuickPick(pointerProviders.map(provider => ({
		label: provider.label,
		description: provider.description,
		detail: provider.detail,
		provider: provider.id
	})), { title: 'Select Pointer Agent provider', placeHolder: 'Credentials remain with each provider' });
	if (selected) {
		await vscode.workspace.getConfiguration('pointer.agent').update('provider', selected.provider, vscode.ConfigurationTarget.Global);
		void vscode.window.showInformationMessage(`Pointer Agent now uses ${selected.label}.`);
	}
}

async function signInWithChatGPT(server: CodexAppServer): Promise<void> {
	try {
		const current = await server.account();
		if (current) {
			const replace = await vscode.window.showInformationMessage(`Codex is already connected${formatAccount(current)}.`, 'Reconnect');
			if (replace !== 'Reconnect') {
				return;
			}
		}
		const login = await server.loginWithChatGPT();
		const completion = waitForLogin(server, login.loginId);
		await vscode.env.openExternal(vscode.Uri.parse(login.authUrl));
		await completion;
		await vscode.workspace.getConfiguration('pointer.agent').update('provider', 'codex', vscode.ConfigurationTarget.Global);
		void vscode.window.showInformationMessage('Codex connected to Pointer Agent.');
	} catch (error) {
		void vscode.window.showErrorMessage(`Could not connect Codex: ${toMessage(error)}`);
	}
}

async function useApiKey(server: CodexAppServer): Promise<void> {
	const apiKey = await vscode.window.showInputBox({ title: 'Connect OpenAI API', prompt: 'Enter an OpenAI Platform API key. It is handled by the Codex credential store.', password: true, ignoreFocusOut: true, validateInput: value => value.trim() ? undefined : 'Enter an API key.' });
	if (!apiKey) {
		return;
	}
	try {
		await server.loginWithApiKey(apiKey.trim());
		await vscode.workspace.getConfiguration('pointer.agent').update('provider', 'codex', vscode.ConfigurationTarget.Global);
		void vscode.window.showInformationMessage('OpenAI API connected to Pointer Agent.');
	} catch (error) {
		void vscode.window.showErrorMessage(`Could not connect the API key: ${toMessage(error)}`);
	}
}

async function signOut(server: CodexAppServer): Promise<void> {
	try {
		await server.logout();
		void vscode.window.showInformationMessage('Codex disconnected from Pointer Agent.');
	} catch (error) {
		void vscode.window.showErrorMessage(`Could not sign out: ${toMessage(error)}`);
	}
}

async function connectAntigravity(antigravity: AntigravityCli): Promise<void> {
	const choice = await vscode.window.showInformationMessage(
		'Antigravity uses Google OAuth or a Google Cloud project. Complete the official login in the integrated terminal.',
		'Open login terminal',
		'Installation guide'
	);
	if (choice === 'Open login terminal') {
		await vscode.workspace.getConfiguration('pointer.agent').update('provider', 'antigravity', vscode.ConfigurationTarget.Global);
		antigravity.openLoginTerminal();
	} else if (choice === 'Installation guide') {
		await vscode.env.openExternal(vscode.Uri.parse('https://antigravity.google/docs/cli-getting-started'));
	}
}

async function connectProvider(provider: PointerProviderId, cloud: CodexAppServer, antigravity: AntigravityCli): Promise<void> {
	if (provider === 'pointer') {
		await vscode.commands.executeCommand('pointer.agent.openModelProviders');
		return;
	}
	if (provider === 'antigravity') {
		await connectAntigravity(antigravity);
		return;
	}
	if (provider === 'local') {
		await selectModel(cloud, antigravity);
		return;
	}
	const choice = await vscode.window.showQuickPick([
		{ label: 'ChatGPT subscription', description: 'Sign in with your ChatGPT account', command: 'chatgpt' },
		{ label: 'OpenAI API key', description: 'Use API billing instead', command: 'apiKey' }
	], { title: 'Connect Codex' });
	if (choice?.command === 'chatgpt') {
		await signInWithChatGPT(cloud);
	} else if (choice?.command === 'apiKey') {
		await useApiKey(cloud);
	}
}

async function selectModel(server: CodexAppServer, antigravity: AntigravityCli): Promise<void> {
	const provider = getProvider();
	try {
		if (provider === 'pointer') {
			const models = await vscode.lm.selectChatModels();
			if (!models.length) {
				const action = await vscode.window.showInformationMessage('No models are configured for Pointer Kernel yet.', 'Open AI & Models');
				if (action === 'Open AI & Models') {
					await vscode.commands.executeCommand('pointer.agent.openModelProviders');
				}
				return;
			}
			const selected = await vscode.window.showQuickPick(models.map(model => ({
				label: model.name,
				description: model.vendor,
				detail: `${model.family}${model.version ? ` · ${model.version}` : ''}`,
				model
			})), {
				title: 'Select Pointer Kernel model',
				placeHolder: models.length ? 'Models from configured APIs and installed extensions' : 'No models configured yet'
			});
			if (selected) {
				await vscode.workspace.getConfiguration('pointer.agent.models').update('model', selected.model.id, vscode.ConfigurationTarget.Global);
			}
			return;
		}
		if (provider === 'local') {
			const response = await fetch('http://127.0.0.1:11434/api/tags');
			if (!response.ok) {
				throw new Error(`Ollama returned ${response.status}.`);
			}
			const body = await response.json() as { models?: Array<{ name: string; size?: number }> };
			const selected = await vscode.window.showQuickPick((body.models ?? []).map(model => ({ label: model.name, description: model.size ? `${(model.size / 1_000_000_000).toFixed(1)} GB` : undefined })), { title: 'Select local Ollama model' });
			if (selected) {
				await vscode.workspace.getConfiguration('pointer.agent.local').update('model', selected.label, vscode.ConfigurationTarget.Global);
			}
			return;
		}
		if (provider === 'antigravity') {
			const models = await antigravity.listModels();
			const selected = await vscode.window.showQuickPick(models, { title: 'Select Antigravity model' });
			if (selected) {
				await vscode.workspace.getConfiguration('pointer.agent.antigravity').update('model', selected, vscode.ConfigurationTarget.Global);
			}
			return;
		}
		const models = await server.listModels();
		const selected = await vscode.window.showQuickPick(models.filter(model => !model.hidden).map(model => ({ label: model.displayName, description: model.isDefault ? 'Default' : model.id, model })), { title: 'Select Codex model', placeHolder: 'Uses your connected Codex account' });
		if (selected) {
			await vscode.workspace.getConfiguration('pointer.agent.codex').update('model', selected.model.id, vscode.ConfigurationTarget.Global);
		}
	} catch (error) {
		void vscode.window.showErrorMessage(`Could not load models: ${toMessage(error)}`);
	}
}

async function waitForLogin(server: CodexAppServer, loginId: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => { disposable.dispose(); reject(new Error('Sign-in timed out.')); }, 5 * 60 * 1000);
		const disposable = server.onNotification(raw => {
			const event = raw as CodexNotification & { loginId?: string; success?: boolean; error?: string };
			if (event.method !== 'account/login/completed' || event.loginId !== loginId) {
				return;
			}
			clearTimeout(timeout);
			disposable.dispose();
			event.success ? resolve() : reject(new Error(event.error || 'Sign-in failed.'));
		});
	});
}

async function handleApproval(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
	if (method === 'item/commandExecution/requestApproval') {
		const command = typeof params.command === 'string' ? params.command : 'Run a command';
		const choice = await vscode.window.showWarningMessage(`Pointer Agent wants to run:\n${command}`, { modal: true }, 'Allow once', 'Allow for session', 'Deny');
		return { decision: choice === 'Allow once' ? 'accept' : choice === 'Allow for session' ? 'acceptForSession' : 'decline' };
	}
	if (method === 'item/fileChange/requestApproval') {
		const reason = typeof params.reason === 'string' ? params.reason : 'Apply file changes';
		const choice = await vscode.window.showWarningMessage(reason, { modal: true }, 'Allow', 'Deny');
		return { decision: choice === 'Allow' ? 'accept' : 'decline' };
	}
	return { decision: 'decline' };
}

function formatAccount(account: CodexAccount): string {
	return account.type === 'chatgpt' ? account.email ? ` as ${account.email}` : '' : account.type === 'apiKey' ? ' with an API key' : '';
}

function toMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function deactivate(): void { }
