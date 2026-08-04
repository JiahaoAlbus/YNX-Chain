# UI design audit

The 1.2.0 native app and signed-out Web companion were inspected in the current run at 2026-07-18 dimensions: Android emulator portrait, desktop Web 1440×900 and mobile Web 390×844.

## Findings and remediation

| Area | Before | 1.2.0 result |
|---|---|---|
| Hierarchy | Native card wall and text-pill navigation; Web resembled a generic admin dashboard | Evidence-first native overview with icon bottom navigation; signed-out Web is a focused product entry with no sidebar |
| Trust semantics | Boundaries existed but competed with controls | YNXT/Testnet/read-only provenance and the non-bank/non-custody/no-yield boundary are adjacent to the primary action |
| Theme | Light-only | System/manual light and dark native themes with checked contrast; Web follows system dark mode |
| Mobile ergonomics | Dense horizontal navigation | Safe-area layout, large touch targets, bottom tabs, readable max widths and scroll recovery |
| Empty/error/offline | Mostly textual fallback | Explicit unavailable, empty, cached-not-live, retry and reauthorize states; no placeholder money or receipts |
| Accessibility | Partial labels | Roles, labels, state text, focus-visible Web controls and locale-aware formatting |
| Localization | Hard-coded English portions | 12 locale packs, Arabic RTL root direction and independently selected AI output language |

## Accepted current-run screenshots

- `artifacts/finance/ui-audit/after/android-signed-out-light.png`
- `artifacts/finance/ui-audit/after/android-signed-out-dark.png`
- `artifacts/finance/ui-audit/after/web-desktop-light.png`
- `artifacts/finance/ui-audit/after/web-mobile-light.png`

The screenshots show only legitimate signed-out states because central Finance registration and installed Wallet approval are not complete. Signed-in product states are covered by source/API tests and are not fabricated for screenshots.

## Remaining design gates

- Capture installed iOS light/dark/RTL states once CI or a full-Xcode host is available.
- Capture real authenticated overview/activity/Pay states only after central Wallet approval and authorized Pay credentials pass.
- Obtain professional review of all legal/privacy translations before a public store release.
