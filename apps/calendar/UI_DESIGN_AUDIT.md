# YNX Calendar UI design audit — 2026-07-18

Status: local candidate, not release-complete. The current run used the checked-in browser proof against a real ephemeral Calendar service, approved a real event preview and opened every screenshot listed below.

## Information architecture and behavior

- Desktop uses a time-boundary/sidebar plus timeline. Day, week and month are now real selectable views, not disabled decoration; month displays bounded recurrence instances.
- Create/update/cancel all flow through preview → explicit approval. Event detail exposes RSVP, sharing, reminder, recurrence, conflict override, revert and AI suggestion boundaries.
- Mobile keeps the timeline horizontally scrollable and preserves a visible event plus floating create action.

## Tokens and platform behavior

- Klein blue `#002FA7`, neutral system surfaces, 1 px time-grid rules and platform system typography keep hierarchy restrained.
- Added dark, increased-contrast, forced-colors and reduced-motion behavior. Focus targets are named and proof reports zero page errors.
- The day view removes week-column rules; month uses a conventional seven-column calendar instead of card tiles.

## Inspected evidence

- `tests/artifacts/calendar-desktop.png` — 1440×900 week success state scrolled to the approved event.
- `tests/artifacts/calendar-desktop-dark.png` — 1440×900 dark week success state.
- `tests/artifacts/calendar-desktop-day.png` — real day view with the same approved event.
- `tests/artifacts/calendar-desktop-month.png` — real month view with weekly recurrence occurrences.
- `tests/artifacts/calendar-mobile.png` — 390×844 mobile success/event state.
- `tests/artifacts/calendar-tablet.png` — 834×1194 tablet week state.
- `tests/artifacts/calendar-arabic-rtl.png` — mirrored RTL timeline and Arabic locale date/time.
- `tests/artifacts/calendar-large-text.png` — 390×844 at 125% root text.
- `tests/artifacts/calendar-loading.png`, `calendar-failure.png`, `calendar-empty.png` — controlled loading, API failure and empty states.
- `tests/artifacts/calendar-android-cold-start-current.png` — installed native Android shell after a separately recorded cold launch.

## Findings fixed in this pass

1. Replaced the disabled month affordance with working day/week/month views and correct query ranges.
2. Changed the success proof to scroll the real approved event into view; the earlier empty top-of-day grid did not prove success.
3. Removed editorial serif typography and added dark/high-contrast/forced-colors coverage.
4. Added account export, session revocation and exact-phrase deletion UI.
5. Added mobile/tablet/RTL/large-text evidence and inspected event cropping/scroll behavior.

## Remaining visual/release limits

- Native catalogs contain all 12 locales and Arabic RTL. The Web companion mirrors RTL geometry but its Chinese interface copy is not fully translated; localization acceptance remains incomplete.
- Mobile week view intentionally scrolls horizontally; a dedicated compact multi-day mode remains a polish opportunity.
- No current-run iOS Simulator screenshot, staging URL, public URL, production signing or hosted download exists.
