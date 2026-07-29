# Project: Pointer

## Architecture & Overview
Pointer is an independent Electron editor based on Pointer-Core / Code OSS.
Language: TypeScript, Node.js 22.22.1, Electron 39.8.8.
Goal: Complete rebranding to Pointer, custom themes (black/white & white/black), remove auth, implement onboarding popup with local model port scanner, and universal agent API support.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Core Rebranding & Installer | Installer assets, icons, product.json, code.iss, build scripts | none | IN_PROGRESS |
| 2 | M2: Custom Themes | Remove stock themes, set Pointer Dark/Light defaults & UI animations | M1 | PLANNED |
| 3 | M3: Authentication Removal | Disable/remove GitHub/Google auth extensions & login UI | M1 | PLANNED |
| 4 | M4: Onboarding & Port Scanner | First-launch popup, automatic scan of local AI ports (11434, 1234, etc.) | M2, M3 | PLANNED |
| 5 | M5: Universal Agent API Support | Coding assistant local model support, OpenAI-compat routing, chat panel | M4 | PLANNED |
| 6 | M6: Release & E2E Validation | Build release installer, full E2E acceptance tests, forensic audit | M1-M5 | PLANNED |

## Interface Contracts & Specifications
### R1: Branding
- Product Name: Pointer
- Installer: PointerSetup-x64.exe (Pointer branding, no Code OSS logos)
- Icons: `resources/win32/code.ico` replaced with Pointer icon, `product.json` verified.

### R2: Custom Themes
- Available Themes: "Pointer Dark" (black/white), "Pointer Light" (white/black).
- Stock Code OSS themes completely purged from builtInExtensions and extension configurations.
- Default theme on fresh profile: "Pointer Dark".

### R3: Onboarding & Local Model Scanning
- Trigger: First launch / clean profile.
- Ports scanned: 11434 (Ollama), 1234 (LM Studio), 8080/8000/5000 (LocalAI/vLLM/Custom).
- UI: Theme-matched onboarding dialog listing discovered models with quick select.

### R4: Authentication Removal
- Auth extensions: `github-authentication`, `microsoft-authentication` disabled/removed from build config & extensions list.
- No login popups, sign-in toasts, or account badges on clean launch.

### R5: Agent API & Local Model Integration
- Default provider: Local Models (http://localhost:11434 or detected endpoint).
- Custom endpoint config: Supports base URL + model name input without forcing remote token auth.
- Chat UI: Renders assistant responses natively in chat panel.

## Code Layout
- `product.json`: Product metadata
- `build/win32/code.iss`: Inno Setup installer script
- `build/gulpfile.vscode.win32.ts`: Gulp packaging logic
- `extensions/`: Built-in extensions (themes, auth, chat/agent)
- `src/vs/workbench/`: UI Workbench components & contributions
