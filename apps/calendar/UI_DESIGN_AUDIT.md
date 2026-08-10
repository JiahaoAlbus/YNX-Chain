# YNX Calendar UI design audit — 2026-07-18

Status: public Testnet Web preview, not production release-complete. The current run used the checked-in browser proof against a real ephemeral Calendar service, approved a real event preview and inspected the public exact-build CSS/JavaScript.

## Information architecture and behavior

- Desktop uses a time-boundary/sidebar plus timeline. Day, week and month are now real selectable views, not disabled decoration; month displays bounded recurrence instances.
- Create/update/cancel all flow through preview → explicit approval. Event detail exposes RSVP, sharing, reminder, recurrence, conflict override, revert and AI suggestion boundaries.
- Mobile fits all seven week columns into 390px without horizontal scrolling, preserves hour labels, a visible event and the floating create action. Day and month views use the same bounded viewport.

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
- GitHub Actions run `29652770138`, hosted `YNXCalendar-unsigned-simulator.app.zip` and `YNXCalendar-cold-launch.png` — independently built, installed, cold-launched and deep-link resolved; downloaded screenshot inspected, SHA-256 `ca377afa7a78a93579d255fe1cd53bd8a695aae6addf71f6c34bb061956d1a71`.

## Findings fixed in this pass

1. Replaced the disabled month affordance with working day/week/month views and correct query ranges.
2. Changed the success proof to scroll the real approved event into view; the earlier empty top-of-day grid did not prove success.
3. Removed editorial serif typography and added dark/high-contrast/forced-colors coverage.
4. Added account export, session revocation and exact-phrase deletion UI.
5. Added mobile/tablet/RTL/large-text evidence and replaced the partially hidden horizontal week strip with a verified seven-day compact grid.

## Remaining visual/release limits

- Native catalogs contain all 12 locales and Arabic RTL. The Web companion mirrors RTL geometry but its Chinese interface copy is not fully translated; localization acceptance remains incomplete.
- Compact mobile event cards intentionally truncate long titles; the full title remains available through the event detail control and accessible name.
- A public Web/API preview exists. Current-source native downloads, production signing and store release do not; iOS evidence is Simulator-only.
