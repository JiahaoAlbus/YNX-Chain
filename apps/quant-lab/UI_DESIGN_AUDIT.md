# YNX Quant Lab UI design audit

## Information architecture

The independent product uses a research workbench, not a strategy-card dashboard. Persistent navigation covers Research, Strategies, Experiments, Paper, Testnet, Risk and Audit. Desktop uses a compact sidebar, toolbar, table workspace and right inspector. Mobile converts navigation to a horizontally scrollable native-like tab strip and stacks the inspector below the task.

## Visual system

Neutral `#F5F5F7` / white and `#000000` / graphite canvases establish hierarchy. Klein Blue `#002FA7` is reserved for selection and primary actions. Warning orange marks the simulated/testnet mode dot; red is limited to live-funds-disabled, kill-switch and destructive semantics. There are no gradients, neon, glow, card walls or decorative motion.

## Internationalization, RTL and formatting

All 32 audited strings have nonblank translations in exactly 12 catalogs: `en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `es`, `fr`, `de`, `pt`, `ru`, `ar`, `id`. The catalog includes Wallet mandate, central unavailable, real-money-disabled, recovery and historical-performance language. Locale selection persists locally; `Intl.DateTimeFormat` formats timestamps. Arabic sets document `dir=rtl`, right-aligns navigation/tables and preserves logical order. Automated catalog parity and 390 px overflow checks cover the boundary.

## Accessibility and motion

Semantic headings, navigation, labels, tables, live status and keyboard-reachable controls are present. The skip link targets the workspace. System light/dark preference and reduced motion are honored. Text and controls remain readable at narrow width; mobile locale selection remains accessible rather than being hidden.

## Truthful states

- Empty strategies/experiments explicitly mean no invented performance.
- A backtest or Paper signal requires the configured Exchange actual-match tape. Empty or unavailable tape fails honestly.
- Testnet displays canonical Wallet mandate requirements and remains unavailable without the central verifier and broker adapter.
- Reconciliation mismatch and kill switch are persistent, audited states.
- Real-money automated trading is structurally disabled.

## Screenshot evidence

- `tmp/quant-lab-evidence/desktop-light.png` — 1440×900 light workbench showing the authoritative-feed unavailable result and an honestly empty experiment table.
- `tmp/quant-lab-evidence/desktop-dark.png` — 1440×900 dark rendering of the same fail-closed state.
- `tmp/quant-lab-evidence/mobile-arabic-rtl.png` — 390×844 Arabic RTL; recorded overflow assertion after fix was `scrollWidth == clientWidth == 375`.
- `tmp/quant-lab-evidence/paper-kill-switch.png` — Paper/risk transition when available from the browser suite.

These are current local Playwright runtime evidence, not staging/public/download evidence. The latest run also verifies that an empty/unconfigured Exchange tape produces `unavailable`, never a generated experiment or Paper fill.

## Fixed during this delivery

- Fixed mobile grid intrinsic-width overflow from 542 px to 375 px at the 390×844 viewport.
- Kept the locale selector available on mobile.
- Removed browser-generated rising prices and user-entered “authoritative volume”; product flows now consume only actual Exchange matches.
- Added parameter-sensitivity and data-gap columns instead of a strategy card wall.

## Remaining limitations

No staging URL or central Wallet mandate verifier is deployed. Real continuous paper evidence requires a configured Exchange endpoint with actual matches; empty venues remain empty. Independent screen-reader/device review is pending.
