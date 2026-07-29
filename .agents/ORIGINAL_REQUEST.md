# Original User Request

## Initial Request — 2026-07-25T15:16:53Z

<USER_REQUEST>
# Teamwork Project Prompt — Draft

> Status: Ready for launch — awaiting user approval.
> Goal: Craft prompt → get user approval → delegate to teamwork_preview

Rebrand the Code OSS installer to "Pointer", polish the UI with animations and custom black/white themes, revamp the onboarding to detect local AI models by scanning default ports, remove all GitHub authentication requirements, and ensure the agentic coding assistant supports any local/remote API seamlessly.

Working directory: c:\Users\User\Documents\Pointer
Integrity mode: development

## Requirements

### R1. Installer and Core Rebranding
Complete the migration of the installer and core application to the Pointer brand. The installer must use Pointer logos and custom themes instead of Code OSS logos.

### R2. Custom Themes
Remove all default Code OSS themes. Implement and ship only the custom Pointer black/white and white/black themes, ensuring these are the absolute defaults and the UI is polished with animations fitting the design language.

### R3. Onboarding Experience
Implement a clean, well-designed onboarding popup that matches the custom theme. It must automatically scan common default ports (e.g., Ollama: 11434, LM Studio: 1234) to detect locally installed AI models and present them cleanly.

### R4. Authentication Removal
Disable the built-in VS Code GitHub/Google authentication providers entirely and remove any forced login prompts or scripts.

### R5. Universal Agent API Support
Ensure the agentic coding assistant supports a "local models first" approach, allowing users to code with local models, custom models, and standard APIs interchangeably without relying on forced remote authentication.

## Acceptance Criteria

### Installation & Branding
- [ ] Running the release build script produces an installer that only uses Pointer branding (no VS Code logos).
- [ ] The installed application is named Pointer and uses the correct icon.

### Theming
- [ ] Built-in Code OSS themes are completely removed from the extension list.
- [ ] Only the Pointer custom black/white themes are available and set as default on first launch.

### Onboarding & Model Detection
- [ ] The onboarding popup appears on first launch.
- [ ] A simulated local API on port 11434 (e.g., mock Ollama server) is successfully detected and displayed in the onboarding UI.

### Authentication
- [ ] Starting the application with a fresh user data directory prompts no GitHub or Google login screens.
- [ ] The built-in authentication extensions are either disabled or removed from the build.

### Agent Functionality
- [ ] The coding assistant successfully routes a prompt to a detected local model (or mock API endpoint) and displays the response in the chat panel.

---
*Next: when approved → delegate via invoke_subagent (see Delegation Protocol)*
</USER_REQUEST>
