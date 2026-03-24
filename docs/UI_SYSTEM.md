# SpotiCheck UI System

## Visual direction

- Dark desktop dashboard with fixed left rail, dedicated group rail, and dense list workspace.
- The list view uses a wide photographic hero strip; preserve that existing pattern instead of introducing new wrappers or alternate shells.
- Spotify green remains the primary functional accent, while the rest of the UI stays on near-black surfaces with low-contrast borders.

## Core palette

- App background: `#0b0f14` to `#111315`
- Sidebar background: `#0a0e13`
- Secondary surfaces: `#1a1d21`, `#1e2328`
- Primary accent: `#1db954`
- Main text: `#f2f5fb`
- Muted text: `#a8b1c0`, `#b3b3b3`
- Borders: thin white alpha strokes around `0.06` to `0.16`

## Typography

- Primary font stack: `"Inter", "Inter Tight", system-ui, sans-serif`
- Headings use `Inter Tight`
- Body text is compact, mostly `13px` to `15px`
- Existing uppercase micro-labels and table labels should only be adjusted when the task explicitly changes copy structure

## Layout and spacing

- Sidebar width: `64px`
- Group rail width: `280px`
- Top bar height: `80px`
- Layout is tight and spreadsheet-like, with thin dividers and restrained spacing

## Radius and shape

- Group items and table rows: around `8px`
- Inputs and dropdowns: around `14px`
- Modal shell: `16px`
- Search and primary action pills: fully rounded

## Component patterns

- Sidebar: icon-first collapsed rail with tooltip labels
- Group rail: flat stacked list with subtle selected and search-match states
- Search: rounded dark input in the top bar
- Rows: cover thumbnail + title/meta on the left, metrics grid on the right
- Buttons:
  - `btn-accent`: white filled primary action
  - `btn-ghost`: transparent secondary action with thin border
- Modals: centered dark dialog with blur backdrop and no detached decorative chrome

## UI guardrails

- Preserve the deployed Shine layout and current control placement
- Keep list rows dense; do not convert them into card-heavy layouts
- Search/filter tasks should stay behavioral unless a visual change is explicitly required
- New UI work should inherit the existing palette, spacing rhythm, and typography rather than introduce a separate design language
