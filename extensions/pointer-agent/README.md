# Pointer AI Kernel

Pointer Agent is the provider-neutral AI runtime for Pointer. The chat surface talks to one kernel while authentication, model discovery, and execution remain owned by the selected provider.

## Runtime paths

| Path | Use | Authentication | Models | Tools |
| --- | --- | --- | --- | --- |
| Pointer Kernel | Configured APIs, local-model extensions, and third-party AI extensions | Provider-owned consent or credential flow | VS Code Language Model registry | VS Code tool registry, including coding plugins and MCP tools |
| Codex | Codex coding agent | ChatGPT login or OpenAI Platform API key through Codex | Codex app server | Codex tools and approval requests |
| Google Antigravity | Google coding agent | Google OAuth or Cloud project through the CLI | Antigravity CLI | Antigravity tools |
| Local | Offline/private coding agent | None | Ollama | Workspace-scoped local tools with Pointer confirmations |

ChatGPT subscriptions, OpenAI Platform API billing, Google accounts, and local runtimes are intentionally separate connection types. The kernel never copies tokens between providers and never stores provider secrets in workspace files.

## Interoperability contract

An AI extension becomes usable by Pointer Kernel when it registers a `LanguageModelChat` through the VS Code Language Model API. Its models then appear in Pointer's model picker without a Pointer-specific adapter.

A coding extension or MCP server becomes usable by compatible models when its tools are present in `vscode.lm.tools`. Pointer invokes those tools with the active `ChatParticipantToolToken`, preserving the editor's progress, confirmation, and audit UI.

Provider-specific adapters are reserved for runtimes with richer native agent protocols, such as Codex app-server sessions or CLIs that own their own tool loop.

## Adding a provider-specific runtime

1. Add one descriptor to `pointerProviders` in `src/pointerKernel.ts`.
2. Keep credential storage and login inside the provider runtime.
3. Route chat execution in `src/extension.ts` without exposing secrets to the prompt.
4. Return model metadata and surface actionable connection errors.
5. Compile with `npm run gulp -- compile-extension:pointer-agent`.

Prefer the generic Pointer Kernel path whenever the provider already implements the Language Model API. This keeps model selection, tools, permissions, and future plugins interoperable by default.
