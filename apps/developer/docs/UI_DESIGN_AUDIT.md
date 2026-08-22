# UI design audit

Audit date: 2026-07-18. Surface: live local YNX Developer Web IDE rendered in
the in-app Browser. Baseline and final captures are under `evidence/ui`.

## Information architecture

The desktop workbench uses a 48 px product toolbar, 52 px activity rail, 260 px
navigator, flexible editor, 360 px YNX AI Build inspector, bottom console and
24 px status bar. This adopts the dense information organization expected of a
VS Code-class editor without copying VS Code branding, icons, protected assets
or exact UI. The primary path is project → file → editor → diagnostics/output →
AI review or Wallet-only deploy review. Command Palette, Artifact Center and
Audit are first-class surfaces.

At 740 px and below the layout becomes a native-feeling stack: compact toolbar,
horizontal workspace switcher, editor/console stack, and off-canvas navigator
or AI inspector. Closed drawers are inert and `aria-hidden`, avoiding the former
four-column squeeze.

## Typography and tokens

- System UI stack; no Apple, Microsoft or benchmark font files are distributed.
- Standard UI 13 px, secondary 12 px, micro labels 11 px, editor 13 px/1.55.
- Large mode raises UI/editor hierarchy to 15–16 px while preserving layout.
- Klein blue `#002FA7` is limited to brand, selection, primary action and focus.
- Light canvas uses neutral near-white surfaces; dark uses black/charcoal.
- Fine one-pixel separators establish hierarchy. Success, warning and error
  color appear only for truthful state.

## Accessibility and localization

Landmarks, skip link, labeled controls, visible focus rings, keyboard shortcuts,
touch targets, reduced-motion and forced-colors handling are present. Theme and
text-size choices persist. Critical workbench controls exist in en, zh-CN,
zh-TW, ja, ko, es, fr, de, pt, ru, ar and id. Arabic switches document direction
to RTL while the source editor remains code-oriented. Locale persistence,
fallback, dates, numbers and plural rules are unit-tested.

### 2026-07-27 current-source delta

Source commit `8f352d0159eef0ab60fb6411e949cfcf3aafb551` extends the API Studio surface with 12-locale labels, approval semantics, dynamic validation states and bounded localized error classes. Arabic applies RTL to interaction surfaces while source, JSON, response and URL fields remain LTR. Bottom-panel navigation now uses tablist/tab/tabpanel semantics, one roving tab stop and ArrowLeft, ArrowRight, Home and End navigation. The API output is a focusable polite live region, and mobile rules wrap long translated actions at the 390px target.

These current-source properties are covered by static/runtime tests and are installed in the separately verified macOS arm64 package source `9bcb984d475a39cc9fcd7e46fbb00adaee0421ca` and Windows x64 package source `5edacf918fa6a4ebaaa96c2270aa9fd579d1af6e`.

### 2026-07-29 current-source browser recapture

A deterministic, dependency-free Chrome DevTools Protocol harness now launches the real local Web Product from a clean pushed source commit, drives keyboard input, reads Chromium's accessibility tree, emulates media/viewport/page scale, and captures PNG evidence. `evidence/ui/current-accessibility/accessibility-audit.json` records 15/15 passed checks and six screenshot SHA-256 values for source `98fcbe3cff68b4b01ebfd94df2d1476b41ecf2b5` using Chrome 151.0.7922.76.

Verified facts include first-tab skip navigation to the editor, one-stop roving panel tabs, named textboxes and navigation/main/tablist/status roles in the browser accessibility tree, a 3 px focus outline, Light/Dark state, reduced-motion animation removal, exact 390 px document width with inert closed drawers, single-column mobile API Studio, Arabic RTL with source/JSON kept LTR, 16 px large-text mode with 38 px controls, and Chromium visual viewport scale 2. No browser runtime exception was observed.

This evidence proves the current source in a local Chrome browser. It does not claim an independent WCAG certification, public deployment, production signing, or a recapture inside the installed macOS/Windows desktop hosts.

## Screenshot evidence

### Current source (`current-accessibility/`)

- `desktop-light-1440x900.png`
- `keyboard-focus-api-studio-1440x900.png`
- `desktop-dark-1440x900.png`
- `mobile-light-390x844.png`
- `mobile-arabic-rtl-390x844.png`
- `mobile-large-text-390x844.png`

### Historical 2026-07-18 checkpoint (`final/`)

- `final/desktop-light-1440x900.png`
- `final/desktop-dark-1440x900.png`
- `final/mobile-light-390x844.png`
- `final/mobile-arabic-rtl-390x844.png`
- `final/mobile-large-text-390x844.png`
- `final/loading-compile-1440x900.png` — real pinned compiler request paused
  in-flight for capture, then continued to its real result.
- `final/empty-project-1440x900.png`
- `final/success-compile-1440x900.png` — real `/ide/compile` evidence.
- `final/failure-provider-unavailable-390x844.png` — real unavailable provider.

All final images were captured at the named true viewport. DOM checks reported
zero page-width overflow. The captures were manually inspected after generation.

## Fixed issues

- Replaced oversized/loose control density with a consistent 13/12/11 px scale.
- Rebalanced navigator/editor/inspector widths and bottom-console height.
- Removed mobile multi-column squeezing; added horizontal switcher and drawers.
- Corrected mobile RTL ordering, inactive drawer semantics and large-text rows.
- Localized the critical workbench, console and AI workflow controls.
- Added real empty/loading/success/failure visual evidence.

## Remaining limits

The editor now embeds Monaco 0.55.1 with per-file models, line numbers, minimap,
bracket guides, suggestions and a fail-visible contenteditable fallback. C++,
JavaScript/TypeScript, Python, Go, Rust and Solidity actions are connected to
reviewed language servers for completion, definition, references, rename,
formatting and diagnostics; a selected cloud runtime routes those requests into
that owner/project-scoped container. It is not the complete VS Code desktop
application: arbitrary VS Code extensions and debug adapters do not
automatically run in Monaco.
Not every explanatory paragraph is translated; the audited critical controls and
safety vocabulary are. Resizable split handles and tablet-specific evidence are
not shipped because the current product contract names desktop and phone; desktop
and mobile layouts remain keyboard/touch usable. Public staging, independent
accessibility audit and production-signed desktop UI evidence remain external.
