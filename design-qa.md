# Pointer AI & Models visual QA

## Reference and implementation

- Reference: `C:\Users\User\AppData\Local\Temp\codex-clipboard-7097e079-d31d-4e3e-953b-6b289aeea216.png`
- Rendered build: `C:\Users\User\.codex\visualizations\2026\07\29\019faf32-4e96-7a52-bdf5-0294c3cda7bb\provider-settings-after.png`
- Side-by-side comparison: `C:\Users\User\.codex\visualizations\2026\07\29\019faf32-4e96-7a52-bdf5-0294c3cda7bb\provider-settings-comparison.png`
- Viewport: 1147 × 691

## Audit findings

- The reference failure was structural: one missing closing brace after `.ps-search-input` caused the remainder of the feature stylesheet to be parsed incorrectly.
- The provider surface also mixed native Monaco controls with a second local button/input system and inline styling, making the result fragile even after the syntax fix.
- The repaired screen has a measured 240px provider rail and a 639px detail panel in the reference viewport. Labels, controls, hints, provider rows, and footer actions remain in their intended containers.
- The rendered provider screen contains four shared buttons, eleven shared inputs/selects, and zero legacy `.monaco-text-button` instances.
- Focus, disabled, hover, validation, dark theme, container-width responsiveness, and accessible label relationships are covered by the shared primitives and the provider markup.

## Verification

- `npm run compile-check-ts-native` — passed.
- `npm run compile` — completed and emitted the updated workbench artifacts.
- `npm run test-browser-no-install -- --grep "ProviderSetupView" --browser chromium --sequential` — 18 passing.
- `git diff --check` — passed for the edited tracked files; only existing LF/CRLF notices were reported.
- Same-state visual comparison — passed after maximizing Settings and matching the 1147 × 691 reference viewport.

final result: passed

# Pointer onboarding visual QA

## Reference and implementation

- Reference: `C:\Users\User\AppData\Local\Temp\codex-clipboard-f86808dc-f390-4c2f-bb93-cf67b1501419.png`
- Rendered build: `C:\Users\User\.codex\visualizations\2026\07\29\019faf32-4e96-7a52-bdf5-0294c3cda7bb\pointer-onboarding-qa.png`
- Side-by-side comparison: `C:\Users\User\.codex\visualizations\2026\07\29\019faf32-4e96-7a52-bdf5-0294c3cda7bb\pointer-onboarding-comparison.png`
- Viewport: 1200 × 835

## Findings

- Removed the hardware badge and performance/cloud marketing footer from the reference.
- Reduced visual noise and aligned the screen to Pointer's native workbench typography and controls.
- Kept the two-column theme grid while making Dark, Obsidian, Cyber, and Light visibly different.
- Confirmed the five-step progress state, runtime cards, model grid, provider detection, Hugging Face input, and Back/Continue navigation render without clipping at the reference viewport.
- Confirmed the footer remains fixed while the larger model catalog scrolls internally.
- The source-mode web preview does not load the bundled Pointer theme extension, so it renders the shell with the default light workbench theme. Theme-specific preview cards and layout are still visible; desktop builds use the selected bundled Pointer theme.
- Source-mode web notifications about missing built-in extensions are test-server artifacts and are outside the onboarding dialog.

## Verification

- `npm run compile-check-ts-native` — passed.
- `npm run gulp compile-extension:pointer-agent` — passed with 0 errors.
- `npm run compile` — passed with 0 errors.
- Theme and product JSON parsing — passed.
- `git diff --check` — passed for edited content; existing line-ending warnings remain elsewhere in the dirty worktree.
- Browser walkthrough — provider detection, horizontal navigation, Hugging Face validation, unrestricted agent assignment, and unrestricted completion assignment passed.

# Pointer unified model selection QA

## Reference and implementation

- Reference: `C:\Users\User\AppData\Local\Temp\codex-clipboard-767d114f-da57-4909-900f-28920a4a40cd.png`
- Rendered build: `C:\Users\User\.codex\visualizations\2026\07\29\019faf32-4e96-7a52-bdf5-0294c3cda7bb\onboarding-model-selection-after-892x899.png`
- Side-by-side comparison: `C:\Users\User\.codex\visualizations\2026\07\29\019faf32-4e96-7a52-bdf5-0294c3cda7bb\onboarding-model-selection-comparison.png`
- Chat icon verification: `C:\Users\User\.codex\visualizations\2026\07\29\019faf32-4e96-7a52-bdf5-0294c3cda7bb\chat-new-agent-cursor-icon.png`
- Viewport: 892 × 899

## Audit findings

1. Healthy: the duplicated model-selection callout is removed; the page now has one title, one source summary, and one action per model.
2. Healthy: the nested catalog scroller is removed. A real wheel/trackpad event moved the page container from `scrollTop 0` to `426`; the footer remained fixed and the visible scrollbar track is gone.
3. Healthy: cards are compact single rows with provider, size, role fit, availability, and selection state instead of repeated `RECOMMENDED` and `Installed` badges.
4. Healthy: Hugging Face pull is retained as a collapsed secondary action and no longer competes with the primary selection path.
5. Healthy: installed, registered, cached, and configured provider models are merged into onboarding; the chat picker remains backed by the live registry plus machine cache.
6. Healthy: Completion falls back to an actually installed compatible model. In the test runtime `StarCoder2 3B` was selected automatically.
7. Healthy: the new-chat/new-agent action uses the stable Cursor codicon and is no longer changed by remote icon experiments.
8. Accessibility: the model list exposes list/listitem semantics, selection buttons expose `aria-pressed`, the custom model section is keyboard reachable, reduced motion remains supported, and focus contrast remains visible.

## Evidence limits

- The local web test runtime exposed Ollama models but no authenticated cloud accounts. Cloud/API/subscription aggregation was verified through registry/configuration code paths and type/tests, not with live credentials.
- Missing built-in extension notifications in the web preview are test-server artifacts outside this feature.

## Verification

- `npm run compile-check-ts-native` — passed.
- `npm run gulp -- compile-extension:pointer-agent` — passed with 0 errors.
- `npm run gulp -- transpile-client-esbuild` — passed.
- `npm run test-browser-no-install -- --grep "buildModelPickerItems" --browser chromium --sequential` — 45 passing.
- Same-state visual comparison at 892 × 899 — passed.
- Browser walkthrough — agent step, completion step, wheel scrolling, selected installed fallback, new-agent icon, and expanded model picker passed.

final result: passed
