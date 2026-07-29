# Pointer UI design language

Pointer-owned screens should feel like one quiet, precise desktop product. They use the active workbench theme, restrained borders, compact spacing, and a single shared control vocabulary. Feature CSS owns layout; the shared primitives own control appearance and interaction states.

## Shared primitives

The canonical classes live in `src/vs/workbench/browser/media/style.css` and are opt-in:

- `.pointer-ui` establishes border-box sizing for a Pointer surface.
- `.pointer-button` is the base button. Add exactly one intent: `.pointer-button-primary`, `.pointer-button-secondary`, `.pointer-button-ghost`, or `.pointer-button-danger`.
- `.pointer-button-small` and `.pointer-button-icon` are size modifiers, not new visual styles.
- `.pointer-input` and `.pointer-select` are the only product-owned text and select controls.

Do not combine these with `.monaco-button`, `.monaco-text-button`, `.monaco-inputbox`, or feature-specific button styling. Do not set button padding, height, font size, colors, radius, hover, or focus styles inline.

## Tokens and rhythm

- Control height: 30px; compact controls: 26px.
- Corner radius: 4px for controls, 6px for grouped surfaces.
- Spacing scale: 4, 8, 12, 16, and 24px.
- Type: workbench font, 13px body, 12px labels/actions, 11px metadata.
- One primary action per action group. Secondary actions recede; destructive actions remain explicit.
- Use workbench color variables only. Pointer surfaces must work in dark, light, and high-contrast themes.

## Layout contract

- Every flex/grid child that can shrink uses `min-width: 0`.
- Embedded views fill their host with `width: 100%` and `height: 100%`.
- Forms use a readable maximum width but never a fixed width.
- Responsive behavior follows the component's measured container, not only the viewport.
- Keep labels above controls and hints directly below them. Never rely on implicit inline flow for form structure.

## Interaction and accessibility

- All actionable controls must be reachable by keyboard and have a visible `:focus-visible` state.
- Icon-only buttons require an accessible name through `aria-label` or `title`.
- Disabled controls remain legible and do not react on hover.
- Validation uses `aria-invalid`, a nearby text error, and theme validation colors; color is never the only signal.
- Motion is short and functional and runs only when `monaco-enable-motion` is active.

## Review checklist

Before merging a Pointer-owned screen, verify dark, light, narrow, and keyboard states. Search the changed feature for inline control styles and legacy Monaco control classes. If a new visual control is needed, extend the shared primitive layer first instead of creating a local one-off class.
