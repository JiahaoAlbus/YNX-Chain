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

## Screenshot evidence

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

The editor is a bounded text editor, not Monaco or a complete language server.
Not every explanatory paragraph is translated; the audited critical controls and
safety vocabulary are. Resizable split handles and tablet-specific evidence are
not shipped because the current product contract names desktop and phone; desktop
and mobile layouts remain keyboard/touch usable. Public staging, independent
accessibility audit and production-signed desktop UI evidence remain external.
