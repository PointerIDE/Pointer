/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export type PointerProviderId = 'pointer' | 'codex' | 'antigravity' | 'local';

export interface PointerProviderDescriptor {
	readonly id: PointerProviderId;
	readonly label: string;
	readonly description: string;
	readonly detail: string;
}

/**
 * The single provider registry used by chat, commands, settings, and model selection.
 * Provider implementations keep ownership of their credentials; the kernel only routes
 * requests and never reads or persists provider secrets.
 */
export const pointerProviders: readonly PointerProviderDescriptor[] = [
	{
		id: 'pointer',
		label: 'Pointer Kernel',
		description: 'Any configured model or AI extension',
		detail: 'Uses Pointer\'s model registry and the tools contributed by installed coding plugins and MCP servers.'
	},
	{
		id: 'codex',
		label: 'Codex',
		description: 'ChatGPT sign-in or OpenAI API billing',
		detail: 'Runs the Codex app server with its own account and approval flow.'
	},
	{
		id: 'antigravity',
		label: 'Google Antigravity',
		description: 'Google OAuth or Cloud project',
		detail: 'Runs the official Antigravity CLI with the selected Google model.'
	},
	{
		id: 'local',
		label: 'Local models',
		description: 'Private models on this device',
		detail: 'Runs an installed Ollama model locally with workspace tools.'
	}
] as const;

export function providerLabel(provider: PointerProviderId): string {
	return pointerProviders.find(candidate => candidate.id === provider)?.label ?? provider;
}

export interface PointerKernelRequest {
	readonly sessionId: string;
	readonly prompt: string;
	readonly request: vscode.ChatRequest;
	readonly configuredModelId?: string;
	readonly stream: vscode.ChatResponseStream;
	readonly token: vscode.CancellationToken;
}

/**
 * Provider-neutral adapter for every model registered through VS Code's Language Model API.
 * This is the interoperability path for custom API providers, local-model extensions, and
 * third-party coding plugins. Tool calls stay inside the editor's confirmation and audit UI.
 */
export class PointerLanguageModelAgent {
	private readonly conversations = new Map<string, vscode.LanguageModelChatMessage[]>();

	async listModels(): Promise<readonly vscode.LanguageModelChat[]> {
		return vscode.lm.selectChatModels();
	}

	async run(options: PointerKernelRequest): Promise<{ readonly model: vscode.LanguageModelChat; readonly toolCount: number }> {
		const model = await this.resolveModel(options.request.model, options.configuredModelId);
		const conversationKey = `${options.sessionId}:${model.vendor}:${model.id}`;
		const history = this.conversations.get(conversationKey) ?? [];
		const tools = selectTools(options.request);
		const firstTurn = history.length === 0;
		const prompt = firstTurn
			? `${POINTER_KERNEL_PROMPT}\n\n${options.prompt}`
			: options.prompt;
		history.push(vscode.LanguageModelChatMessage.User(prompt));

		for (let step = 0; step < MAX_TOOL_STEPS; step++) {
			if (options.token.isCancellationRequested) {
				break;
			}

			const response = await model.sendRequest(history, {
				justification: 'Run the user-selected model as the Pointer coding agent.',
				tools,
				toolMode: vscode.LanguageModelChatToolMode.Auto
			}, options.token);
			const assistantParts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [];
			const toolCalls: vscode.LanguageModelToolCallPart[] = [];

			for await (const part of response.stream) {
				if (part instanceof vscode.LanguageModelTextPart) {
					assistantParts.push(part);
					options.stream.markdown(part.value);
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					assistantParts.push(part);
					toolCalls.push(part);
				}
			}

			if (assistantParts.length) {
				history.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));
			}
			if (!toolCalls.length) {
				this.conversations.set(conversationKey, trimHistory(history));
				return { model, toolCount: tools.length };
			}

			const results: vscode.LanguageModelToolResultPart[] = [];
			for (const call of toolCalls) {
				options.stream.progress(friendlyToolName(call.name));
				try {
					const result = await vscode.lm.invokeTool(call.name, {
						input: call.input,
						toolInvocationToken: options.request.toolInvocationToken
					}, options.token);
					results.push(new vscode.LanguageModelToolResultPart(call.callId, result.content));
				} catch (error) {
					results.push(new vscode.LanguageModelToolResultPart(call.callId, [
						new vscode.LanguageModelTextPart(`Tool failed: ${toMessage(error)}`)
					]));
				}
			}
			history.push(vscode.LanguageModelChatMessage.User(results));
		}

		this.conversations.set(conversationKey, trimHistory(history));
		if (!options.token.isCancellationRequested) {
			throw new Error(`Pointer Kernel stopped after ${MAX_TOOL_STEPS} tool steps. Refine the request and try again.`);
		}
		return { model, toolCount: tools.length };
	}

	private async resolveModel(selectedModel: vscode.LanguageModelChat, configuredModelId: string | undefined): Promise<vscode.LanguageModelChat> {
		if (!configuredModelId || configuredModelId === selectedModel.id) {
			return selectedModel;
		}
		const [configuredModel] = await vscode.lm.selectChatModels({ id: configuredModelId });
		if (configuredModel) {
			return configuredModel;
		}
		throw new Error(`The configured model '${configuredModelId}' is no longer available. Choose another model.`);
	}
}

const MAX_TOOL_STEPS = 16;
const MAX_EXPOSED_TOOLS = 128;
const MAX_HISTORY_MESSAGES = 40;

const POINTER_KERNEL_PROMPT = [
	'You are Pointer Agent, the provider-neutral coding agent inside Pointer.',
	'Inspect relevant workspace context before making changes and use registered tools when they improve correctness.',
	'Respect tool confirmations and the user\'s authorization boundary.',
	'Never request, reveal, copy, or persist provider credentials.',
	'Do not claim a command or edit succeeded until its tool result confirms it.'
].join(' ');

function selectTools(request: vscode.ChatRequest): vscode.LanguageModelChatTool[] {
	const explicitlyAttached = new Set(request.toolReferences.map(reference => reference.name));
	const candidates = explicitlyAttached.size
		? vscode.lm.tools.filter(tool => explicitlyAttached.has(tool.name))
		: vscode.lm.tools;
	return candidates.slice(0, MAX_EXPOSED_TOOLS).map(tool => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema
	}));
}

function trimHistory(history: vscode.LanguageModelChatMessage[]): vscode.LanguageModelChatMessage[] {
	if (history.length <= MAX_HISTORY_MESSAGES) {
		return history;
	}
	return [history[0], ...history.slice(-(MAX_HISTORY_MESSAGES - 1))];
}

function friendlyToolName(name: string): string {
	const label = name.replace(/^mcp_/, '').replace(/[._-]+/g, ' ').trim();
	return label ? `Using ${label}` : 'Using tool';
}

function toMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
