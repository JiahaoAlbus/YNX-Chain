# YNX Search UI design audit

Audited 2026-07-18 against the Task 13 visual and accessibility gates.

## Information architecture and visual system

The page is a search product, not an admin dashboard: a compact product header,
one search task, a filter toolbar, linear source results, auditable states, and a
small footer for correction/removal/appeal. Results are separated by rules and
typography rather than colored cards. The only accent is YNX Klein blue
(`#003cff`); light/dark surfaces, semantic text colors, native selects, and a
1120 px content measure come from CSS tokens in `src/public/styles.css`.

The core path is operational: query, source/freshness/type filters, deterministic
pagination, source metadata, AI permission preview, Index status, Wallet handoff,
and audited cases. Initial, loading, empty, success, failure/retry, offline,
partial, and unavailable states are explicit. Replay/tamper/expiry apply to the
Wallet callback and appear as rejected status rather than success.

## Responsive, locale, and accessibility evidence

- Desktop light/dark: `evidence/ui/search-desktop-*-1440x900.png`.
- Mobile empty/large text: `evidence/ui/search-mobile-*-390x844.png`.
- Arabic RTL tablet: `evidence/ui/search-tablet-arabic-rtl-1024x768.png`.
- Failure/retry: `evidence/ui/search-desktop-failure-retry-1440x900.png`.
- Real staging desktop/mobile: `evidence/staging/search-staging-*.png`.

All six local visual scenarios are asserted by Playwright. The 390 px header was
changed from a horizontally clipped row to a two-column grid, and becomes one
column at 150% text. The final large-text test asserts no document-level
horizontal overflow. Arabic sets both `lang=ar` and `dir=rtl`; labels and control
order follow RTL. Twelve locales are available: en, zh-CN, zh-TW, ja, ko, es,
fr, de, pt, ru, ar, and id.

Keyboard focus is visible, controls meet the 44 px target, semantic forms,
headings, live regions, dialogs and labels are present, reduced motion disables
animation, high contrast strengthens borders, and color is never the sole state
signal. Light and dark states were visually inspected at identical viewports.

## Issues found and fixed

- Removed duplicated screen-reader labels that were visibly rendered.
- Replaced fake glyph controls with text/native controls.
- Removed mobile one-letter button compression and header clipping.
- Localized the core Arabic search, filter, result, and status copy.
- Replaced full-page screenshots with exact viewport captures.
- Kept results as source-first lines rather than a card wall.

## Remaining boundaries

The staging corpus is intentionally empty until an operator supplies approved
HTTPS sources and authorization/robots evidence. AI, Wallet Gateway, and Trust
are visibly unavailable because no central credentials are installed. These are
truthful availability limits, not placeholder success states. Staging is a
Testnet Preview and is not a public production/global index.
