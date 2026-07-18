# YNX Mail UI design audit — 2026-07-18

Status: local candidate, not release-complete. The current run used the checked-in browser proof against a real ephemeral Mail service and persistent Mail state; screenshots were opened and inspected, not inferred from tests.

## Information architecture and behavior

- Desktop uses a Mail-appropriate rail → message list → reading pane hierarchy. Mobile collapses to a focused reading pane with bottom folders and a floating compose action.
- Inbox/thread/compose/search/archive/spam/block/report/appeal, attachment disclosure, delivery state, retry and AI preview/approve/review controls are interactive. Account control exposes export, session revocation and exact-phrase deletion.
- The visible boundary says YNX-known-handle delivery only. No screen calls this internet email or implies SMTP delivery.

## Tokens and platform behavior

- Klein blue `#002FA7` is the restrained action/identity color; neutral system surfaces, 1 px dividers, 8–12 px radii and the platform system font stack carry the hierarchy.
- Added dark, increased-contrast, forced-colors and reduced-motion behavior. Focus targets are named and browser proof reports zero page errors.
- Native Android/iOS use their platform controls and independent package/bundle identity; the Web surface is an optional desktop companion.

## Inspected evidence

- `tests/artifacts/mail-desktop.png` — 1440×900 light success/thread state.
- `tests/artifacts/mail-desktop-dark.png` — 1440×900 dark success/thread state.
- `tests/artifacts/mail-mobile.png` — 390×844 mobile success/thread state.
- `tests/artifacts/mail-tablet.png` — 834×1194 split/tablet state.
- `tests/artifacts/mail-arabic-rtl.png` — 390×844 mirrored RTL geometry and locale-aware date.
- `tests/artifacts/mail-large-text.png` — 390×844 at 125% root text.
- `tests/artifacts/mail-loading.png`, `mail-failure.png`, `mail-empty.png` — controlled loading, API failure and empty states.
- `tests/artifacts/mail-android-cold-start-current.png` — installed native Android shell after a separately recorded cold launch.

## Findings fixed in this pass

1. Removed the editorial serif typography that conflicted with the system-font product rule.
2. Added dark/high-contrast/forced-colors coverage without decorative gradients or neon.
3. Replaced browser bearer/localStorage sessions with strict HttpOnly same-site cookies and removed the misleading legacy Wallet query callback.
4. Added account export, session revocation and destructive deletion UI with exact confirmation phrase.
5. Re-generated evidence after detecting that an earlier browser proof had connected to a stale local process.

## Remaining visual/release limits

- The native clients are functional native shells but do not yet match the richer Web information density.
- Native catalogs contain all 12 locales and Arabic RTL. The Web companion currently mirrors RTL geometry for Arabic but its Chinese interface copy is not fully translated; this is not marked localized-complete.
- No current-run iOS Simulator screenshot, staging URL, public URL, production signing or hosted download exists.
