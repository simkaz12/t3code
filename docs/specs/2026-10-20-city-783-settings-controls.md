# City 783 settings controls

## Problem / Solution

Under the `city-783` environment theme, the settings pages still use the stock control shapes. The theme-wide radius reset squares the switch thumb inside a track drawn round, checkboxes and radios keep their stock marks, the slider thumb stays a pill, kbd chips use the 4% grey, the settings nav marks the active section with a fill, and theme cards are rounded with a ring. The owner approved four design boards for T3 settings in the City 783 language (`/home/sim/Projects/pi-assistant/docs/design/t3code/`: `controls.html`, `settings-appearance.html`, `settings-general.html`, `settings-keybindings.html`). This brief implements those boards' controls in the web client, scoped to the theme only. Other themes render exactly as before.

## Inherited agreement

### Observable behavior and examples

With the City 783 theme active, on Settings → Appearance, General, and Keybindings:

- A switch is a 36x18 slot with a 1px line and a 12px square block. Off: muted block on the left, hollow square mark on the right. On: red fill (`#ad2222`), bright block on the right, a 2px bright bar mark on the left. Hover raises the fill to 8% and the line to muted. Focus is the 2px red-white gradient edge; on an ON switch the inverted gradient. Disabled is 40% opacity.
- A checkbox is an 18px square with a 1px `#4b515b` line; checked fills `#ad2222` with a bright mark. A radio is the same square with an 8px `#ff5c5c` inner square when checked.
- Select triggers, text inputs, and number fields are square with a 1px line at the 4% fill; the select popup has 6px cut corners and the drawn edge (already in place for popups). Number ± keys are square.
- The settings slider has a 2px track and a 10x10 square thumb; no radius anywhere.
- Kbd chips are 20px tall, `#2b2f37` fill, muted text, no radius. Badges are flat.
- The settings nav marks the active section with a 2px `#ff5c5c` bar inset 5px top and bottom on the left edge, bright bold label, no fill. Hover is the 8% fill. Section heads are lowercase.
- Theme cards keep their palette previews, get the 6px chamfer and a 1px grey edge; the selected card gets the gradient edge instead of the ring.
- Everything above is CSS keyed on `html[data-theme-id="city-783"]` and existing `data-slot` hooks. With any other theme active, nothing changes.

Acceptance path: dev server at `http://localhost:5733/`, City 783 selected, open Settings → Appearance, General, Keybindings and compare against the boards at `file:///home/sim/Projects/pi-assistant/docs/design/t3code/`.

### Evidence

- Switch root `data-slot="switch"`, thumb `data-slot="switch-thumb"`, checked via `data-checked` / `data-unchecked`, size var `--thumb-size` — `apps/web/src/components/ui/switch.tsx:16-37` [read]
- Menu switch item `data-slot="menu-checkbox-item"`, indicator span without slot, `rounded-full p-px` — `apps/web/src/components/ui/menu.tsx:138-148` [read]
- Checkbox `data-slot="checkbox"` with `rounded-[.25rem]` and `before:rounded-[3px]`, indicator `data-slot="checkbox-indicator"` — `checkbox.tsx:11-21` [read]
- Radio item `data-slot="radio"` with `before:rounded-full`, indicator `data-slot="radio-indicator"` `before:size-2 before:rounded-full` — `radio-group.tsx:22-31` [read]
- Select slots `select-trigger`, `select-value`, `select-icon` (lucide `ChevronDownIcon`), `select-popup`, `select-item` — `select.tsx:51-186` [read]
- Settings slider is `<input type="range" class="settings-slider">`, CSS at `index.css:951-1049` inside `@layer components`, thumb/track radius 9999px — `SettingsPanels.tsx:1176-1222`, `index.css:965-1006` [read]
- Kbd `data-slot="kbd"` base `h-5 min-w-5 rounded bg-muted text-xs`; badge `data-slot="badge"` — `kbd.tsx:12`, `badge.tsx:52` [read]
- Settings nav rows are `SidebarMenuButton` with `data-active` — `SettingsSidebarNav.tsx:342-343`, `ui/sidebar.tsx:733,815` [read]
- Theme card `data-theme-library-card="<id>"`, selected = `bg-accent/30` + inline `boxShadow: inset 0 0 0 1px var(--ring)`, select button `aria-pressed` — `ThemeSettings.tsx:155,302` [read]
- Input wrapper `data-slot="input-control"`; number field `number-field-group`, `number-field-decrement`, `number-field-increment` — `input.tsx:75`, `number-field.tsx:39-73` [read]
- Settings row `data-slot="settings-row"`; `SettingsSection` heading has no slot — `settingsLayout.tsx:213-311` [read]
- Theme-wide radius reset at specificity (0,1,1) via `:where(*:not(.rounded-full))` plus `::before`/`::after` branches, exempting `rounded-full` — `index.css` city-783 block [read]
- Drawn-edge ring utility: `--edge-w`, `--edge-paint`, `--edge-cut`, `--edge-ring` polygon on `::after`; defaults set via `:where(<targets>)`; popups ring via `.surface-clip.relative` — `index.css` city-783 block [read]
- Dev server on :5733 serves `index.css` live; hot reload picks up CSS edits — `curl http://localhost:5733/src/index.css` [ran]

### Uncertainty

- `SettingsSection` heading element and class — read `settingsLayout.tsx:213-240` in scope 6 before writing the lowercase rule.
- `badgeVariants` base classes — read `badge.tsx` in scope 5; only radius and shadow matter.

## Decisions locked

- D1: Switch is the "slot and block" design with I/O marks, not the "keys" off/on text design — owner prefers icons over text.
- D2: Settings window stays frameless, like the chat shell — owner removed the app frame; the boards' window frame is the canvas convention, not a T3 request.
- D3: Theme cards keep their palette previews; only shape and edge change — City 783 would otherwise be the only grey card among colored ones, and the owner did not ask for wireframes.
- D4: All styling is theme-scoped CSS in `apps/web/src/index.css` keyed on existing `data-slot` / `data-*` hooks; primitives in `components/ui` are not edited unless a hook is missing, in which case add a `data-` attribute only — `docs/internals/web-ui.md` allows global CSS for runtime theme variables; `shadcn/no-restyle` does not read CSS.
- D5: Switch marks are pseudo-elements (`[data-slot="switch"]::before` for the right-hand hollow mark, `[data-slot="switch-thumb"]::after` for the ON bar), no DOM change — the boards' `<i>`/`<b>` markup maps 1:1 onto root/thumb pseudo-elements.
- D6: State tokens: hover = fg 8% over the surface, focus = 2px gradient edge (`--city-edge-gradient`), ON focus = inverted gradient `linear-gradient(35deg, #eceff2 0 40%, #ad2222 50%, #eceff2 60% 100%)`, disabled = 40% opacity — from `controls.html`.
- D7: Slider = 2px track, 10x10 square thumb, no radius — from `controls.html`; rejected: keeping the pill thumb as an accepted exemption.
- D8: Settings nav active row = 2px `#ff5c5c` bar inset 5px, bright bold label, no fill — the canvas rail style; rejected: the list-cursor style with `#2b2f37` fill, which belongs to thread rows, not nav.
- D9: Section heads lowercase on settings pages only; user-entered strings untouched.

## Constraints

- Scope the radius reset's exemptions: `rounded-full` elements inside these controls (switch thumb uses `rounded-(--thumb-size)`, radio uses `before:rounded-full`) must come out square under the theme; check each selector beats the reset's exemption branches (`:where(*:not(.rounded-full))`, `:not([class*="before:rounded-full"])::before`). Use explicit theme-scoped rules on the slot selectors with `border-radius: 0`; specificity `html[attr] [data-slot=…]` (0,2,1) beats the reset.
- No `!important`. No animation beyond the switch block's `translate` transition (120ms, `steps(3)`), which is one-shot.
- No `box-shadow`, blur, or glass on controls under the theme; neutralise `shadow-xs`/`inset-shadow` on switch, checkbox, select trigger, input-control, number-field-group with a theme-scoped `box-shadow: none` on those slots.
- `--thumb-size` stays as the primitive's sizing var; override it under the theme to `18px` on the switch root (`--thumb-size: 18px`) only if the 36x18 geometry cannot be reached by overriding `width`/`height` directly; prefer direct geometry on the root and thumb.
- Lint and typecheck targets only: `vp lint` on any touched tsx, `vpr typecheck` in `apps/web` once at integration. No repo-wide checks. No browser from the runner; the owner checks visually at :5733.
- Compile check: `node /tmp/city783-radius-order.mjs` style script with `@tailwindcss/node` 4.3.3 confirms new rules emit at depth 0 after the reset.

## Execution plan

All scopes edit `apps/web/src/index.css` inside the City 783 block, after the drawn-edge rules; work them in order.

### Scope 1: switch

- **Files:** Modify `apps/web/src/index.css`
- **Build:** the "slot and block" switch for `[data-slot="switch"]` and the menu switch indicator.
- **Steps:**
  1. Root `html[data-theme-id="city-783"] [data-slot="switch"]`: `width: 36px; height: 18px; border-radius: 0; box-shadow: none; padding: 0; position: relative; isolation: isolate; background: #4b515b; --sw-fill: color-mix(in srgb, #b9bec6 4%, #181a1f)`. Fill via `::before { content: ""; position: absolute; inset: 1px; z-index: -1; background: var(--sw-fill) }`. Note the root already uses `data-checked:bg-primary data-unchecked:bg-input`; the theme rule's `background` on the root is the line colour and must win (unlayered beats utilities).
  2. Hollow mark: `[data-slot="switch"]::after { content: ""; position: absolute; top: 6px; right: 6px; width: 6px; height: 6px; border: 1px solid #4b515b; box-sizing: border-box }`. Check the root does not already use `::after` for the ring (it is not an edge target; confirm).
  3. Thumb `[data-slot="switch-thumb"]`: `position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 0; box-shadow: none; translate: 0 0; background: #8f949c; transition: translate 120ms steps(3)`. Override the utility `data-checked:translate-x-[…]` with `[data-slot="switch"][data-checked] [data-slot="switch-thumb"] { translate: 18px 0; background: #eceff2 }`. If the primitive applies the translate via `transform` rather than `translate`, set `transform: none` on the thumb under the theme and use `translate`.
  4. ON state root: `[data-slot="switch"][data-checked] { background: #ad2222; --sw-fill: #ad2222 }` and the bar mark `[data-slot="switch"][data-checked]::after { top: 6px; left: 9px; right: auto; width: 2px; height: 6px; border: 0; background: #eceff2 }`.
  5. Hover: `[data-slot="switch"]:hover { background: #8f949c; --sw-fill: color-mix(in srgb, #b9bec6 8%, #181a1f) }`; ON hover `background: color-mix(in srgb, #eceff2 14%, #ad2222); --sw-fill: same`.
  6. Focus: `[data-slot="switch"]:focus-visible { background: var(--city-edge-gradient); outline: none }` with `::before { inset: 2px }`; ON focus uses the inverted gradient. Neutralise the primitive's ring classes (`focus-visible:ring-*`) with `box-shadow: none` on the root.
  7. Disabled: `[data-slot="switch"][data-disabled], [data-slot="switch"]:disabled { opacity: .4 }`.
  8. Menu switch indicator: `[data-slot="menu-checkbox-item"] > span.rounded-full` is not a stable hook; read `menu.tsx:138-150` and target the indicator by its position (`[data-slot="menu-checkbox-item"] > :first-child` or the span's unique class combination). Apply the same slot geometry at 28x14 with a 10px block, or, if the hook is unstable, leave the menu switch square-cornered only and report it.
- **Verify:** `vp fmt --check apps/web/src/index.css`; `vp test run apps/web/src/themeBoot.test.ts` passes; compile check shows the switch rules at depth 0 after the reset; owner opens Settings → General and toggles "Project grouping": block moves in three steps, red when on, marks visible.

### Scope 2: checkbox and radio

- **Files:** Modify `apps/web/src/index.css`
- **Build:** 18px square checkbox with `#4b515b` line, red fill when checked; radio as the same square with an 8px `#ff5c5c` inner square.
- **Steps:**
  1. `[data-slot="checkbox"]`: `width: 18px; height: 18px; border-radius: 0; box-shadow: none; border: 1px solid #4b515b; background: color-mix(in srgb, #b9bec6 4%, #181a1f)`; `::before { border-radius: 0 }` to beat `before:rounded-[3px]`. Checked: `[data-slot="checkbox"][data-checked] { background: #ad2222; border-color: #ad2222 }`; `[data-slot="checkbox-indicator"] { color: #eceff2; background: transparent }` (indicator currently `data-checked:bg-primary`; keep the mark glyph, drop the fill).
  2. `[data-slot="radio"]`: same box; `::before { border-radius: 0 }` to beat `before:rounded-full`. `[data-slot="radio-indicator"]::before { width: 8px; height: 8px; border-radius: 0; background: #ff5c5c }`; unchecked indicator hidden as today.
  3. Hover both: line `#8f949c`, fill 8%. Focus both: 2px gradient via `outline: 2px solid transparent; border-color: transparent; background: var(--city-edge-gradient) padding-box` is not possible with a single border; use the drawn-edge pattern: root `background: var(--city-edge-gradient)`, `::before` inset 2px painting the fill. Disabled 40%.
- **Verify:** fmt; themeBoot test; compile check; owner checks a checkbox (Settings → Keybindings has none; use the Diff/Storage panels or the command palette's checkbox items) and the radio group in Settings → Appearance color scheme if rendered as radios, else the composer model picker radios.

### Scope 3: select, input, number field

- **Files:** Modify `apps/web/src/index.css`
- **Build:** square fields with a 1px line and 4% fill; select chevron replaced by a `▾` glyph; number ± keys square.
- **Steps:**
  1. `[data-slot="select-trigger"]`, `[data-slot="input-control"]`, `[data-slot="number-field-group"]`: `border-radius: 0; box-shadow: none; border: 1px solid color-mix(in srgb, #b9bec6 28%, #20232a); background: color-mix(in srgb, #b9bec6 4%, #20232a); min-height: 30px`. Hover: text `#eceff2`. Focus-within: `border-color: transparent` plus the drawn edge pattern (`position: relative; isolation: isolate; background: var(--city-edge-gradient)`, `::before` inset 2px with the fill). Confirm `input-control` and `number-field-group` do not already use `::before` for a hairline (`before:shadow-[…]` exists on input; set `box-shadow: none` on `::before` too).
  2. `[data-slot="select-icon"] svg { display: none }` and `[data-slot="select-icon"]::after { content: "▾"; font-size: 11px; color: #8f949c }`.
  3. `[data-slot="select-item"][data-selected]`: `background: #2b2f37; color: #eceff2`; `[data-highlighted]`: fg 8% fill. The popup already has the cut and ring.
  4. `[data-slot="number-field-decrement"], [data-slot="number-field-increment"]`: `border-radius: 0; box-shadow: none; width: 28px; background: color-mix(in srgb, #b9bec6 4%, #20232a)`; hover 8%.
- **Verify:** fmt; themeBoot; compile check; owner opens Settings → Appearance "Background" select and General "Days of inactivity" number field.

### Scope 4: slider

- **Files:** Modify `apps/web/src/index.css`
- **Build:** 2px track, 10x10 square thumb.
- **Steps:**
  1. The `.settings-slider` rules at `index.css:951-1049` live in `@layer components`; the theme rules go in the unlayered City 783 block and therefore win. Add `html[data-theme-id="city-783"] .settings-slider::-webkit-slider-runnable-track { height: 2px; border-radius: 0 }`, `::-webkit-slider-thumb { width: 10px; height: 10px; border-radius: 0; margin-top: -4px; background: #b9bec6; border: 0; box-shadow: none }`, and the `::-moz-range-track`, `::-moz-range-progress`, `::-moz-range-thumb` equivalents. Keep the progress fill colour var; set the filled part to `#ad2222`.
  2. Focus-visible thumb: `background: #ff5c5c; outline: 2px solid #ff5c5c; outline-offset: 2px` (no clip on the thumb, so an outer outline is fine).
- **Verify:** fmt; themeBoot; compile check; owner drags "Glass opacity" and "Contrast" sliders in Settings → Appearance.

### Scope 5: kbd and badge

- **Files:** Modify `apps/web/src/index.css`
- **Build:** 20px kbd chips with `#2b2f37` fill and muted text; flat badges.
- **Steps:**
  1. `[data-slot="kbd"]`: `height: 20px; padding: 0 7px; border-radius: 0; background: #2b2f37; color: #8f949c; font-family: var(--font-mono); font-size: 11px; font-weight: 400; box-shadow: none`.
  2. `[data-slot="badge"]`: `border-radius: 0; box-shadow: none`; read `badgeVariants` for the destructive variant and set it to `background: #e53939; color: #181a1f; font-weight: 800; font-size: 11px` under the theme. Other variants keep their role colours.
- **Verify:** fmt; themeBoot; compile check; owner opens Settings → Keybindings and reads a few chips.

### Scope 6: settings nav and section heads

- **Files:** Modify `apps/web/src/index.css`; Modify `apps/web/src/components/settings/SettingsSidebarNav.tsx` only if a stable hook is missing (attribute only).
- **Build:** active section row with the 2px red bar and bright bold label; lowercase section heads on settings pages.
- **Steps:**
  1. Hook: the nav rows are `SidebarMenuButton` with `data-active`. Scope the rule to the settings nav only: find the nav's root element in `SettingsSidebarNav.tsx:110` and, if it lacks a `data-` attribute, add `data-settings-nav` to it. Rule: `html[data-theme-id="city-783"] [data-settings-nav] [data-slot="sidebar-menu-button"][data-active="true"] { background: transparent; color: #eceff2; font-weight: 700; position: relative }` and `::before { content: ""; position: absolute; left: 0; top: 5px; bottom: 5px; width: 2px; background: #ff5c5c }`. Confirm the button's `data-slot` value in `ui/sidebar.tsx:733` and that the row is not an edge target (so `::before` is free). Hover (non-active): `background: color-mix(in srgb, #b9bec6 8%, transparent)`.
  2. Section heads: read `settingsLayout.tsx:213-240` for the heading element in `SettingsSection`; if it has no slot, add `data-slot="settings-section-title"` to the heading (attribute only, allowed), then `html[data-theme-id="city-783"] [data-slot="settings-section-title"] { text-transform: lowercase; color: #eceff2; font-weight: 700 }`.
- **Verify:** fmt; `vp lint` on any touched tsx from the repo root; themeBoot; compile check; owner opens Settings and clicks between Appearance and General: the red bar follows, labels are bold bright, group heads read lowercase.

### Scope 7: theme cards

- **Files:** Modify `apps/web/src/index.css`
- **Build:** theme cards with the 6px chamfer and a 1px grey edge; selected card with the gradient edge.
- **Steps:**
  1. Add `[data-theme-library-card]` to the drawn-edge target lists (the `:where()` defaults rule, the shared `:is()` clip/vars rule, and the `::after` ring rule) in the City 783 block, so it gets `clip-path: var(--edge-outer)` and the 1px ring. Set `border-radius: 0; border-color: transparent; background: #20232a; box-shadow: none`.
  2. Selected: the component sets an inline `boxShadow: inset 0 0 0 1px var(--ring)` and `bg-accent/30` when active, with no `data-` selected attribute. Target the selected state through the select button inside it: `[data-theme-library-card]:has([aria-pressed="true"]) { --edge-w: 2px; --edge-paint: var(--city-edge-gradient); box-shadow: none !important }` is forbidden (no `!important`); instead confirm whether the inline `boxShadow` is only set when active and, if so, accept it being drawn inside the ring (it is 1px inset `--ring` = `#ff5c5c`, which reads as part of the selected treatment) or add `data-active` to the card element in `ThemeSettings.tsx:155` (attribute only) and drop nothing else. Prefer the attribute.
- **Verify:** fmt; `vp lint` on `ThemeSettings.tsx` if touched; themeBoot; `vp test run apps/web/src/themePalette.test.ts`; compile check; owner opens Settings → Appearance: cards chamfered, City 783 card carries the gradient edge.

## Integration verify

- `vpr typecheck` in `apps/web`: 0 errors.
- `vp lint` from the repo root on every touched `.tsx`: exit 0 (two pre-existing `react(purity)` `Date` errors in `Sidebar.tsx` are known and not in scope).
- Compile `apps/web/src/index.css` with `@tailwindcss/node` 4.3.3 (script in `/tmp`): every new rule emits at depth 0; grep confirms no `!important` was added inside the City 783 block.
- `curl -s http://localhost:5733/src/index.css | grep -c 'data-slot="switch"'` ≥ 1 (dev server serving the change).
- Owner acceptance at `http://localhost:5733/` against the four boards.

## Out of scope

Mobile. Other themes. The composer, chat, and sidebar thread rows. Status-colour hue leaks, glass/blur on popovers, right-rail tabs, lowercase outside settings. Editing `components/ui` primitives beyond adding a `data-` attribute. Done means: all seven scopes verified, integration checks green, and the owner has eyeballed the three settings pages.

## Review handoff

Runner: `spec-runner` with this brief; works scopes 1 to 7 in order in one tree; never commits; no browser. Reviewer: `spec-reviewer` with this brief and the runner's verdict; runs Codex once; checks each scope's rule against the matching board CSS in `controls.html` (the `<pre>` blocks are the source of truth for values), confirms default safety (no rule without the `html[data-theme-id="city-783"]` prefix), and confirms no `!important` and no primitive restyle beyond attributes. A failed result returns as a local fix, a missing fact (a slot or state attribute that differs from the evidence table), or a decision reopening (D2 frame, D3 theme cards).
