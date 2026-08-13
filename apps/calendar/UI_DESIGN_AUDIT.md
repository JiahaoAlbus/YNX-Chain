# YNX Calendar UI design audit — 2026-08-13

Status: current-source local implementation verified; public Testnet deployment still points to the previous visual build until the release step completes.

## Audited flow

1. **Start / account boundary — healthy after correction.** The first screen now presents the real YNX mark, the Wallet path, recovery path, device-only trial, and three factual product principles in one bounded surface. It no longer uses a full-screen Klein-blue field or a letter placeholder.
2. **Week planning — healthy after correction.** Desktop retains all views, date controls, activity, audit, assistant, locale, account, search, calendar filters and the seven-day timeline without page-level horizontal overflow.
3. **Create event — healthy after correction.** The editor is split into event details, recurrence/preparation, and calendar/access sections. Its content scrolls independently while the Review changes action stays visible.
4. **390 px week planning — healthy after correction.** The seven-day week remains readable without horizontal scrolling. Secondary tools move into a fixed bottom bar instead of clipping the top bar; account and date context remain at the top.
5. **390 px create event — healthy after correction.** The form becomes one column, retains the section hierarchy and keeps the explicit review action visible. An invisible toast could previously intercept the floating create action; `pointer-events: none` now prevents that failure.

## Current-run screenshot evidence

- `tests/artifacts/design-audit-20260813/01-start.png` — public pre-change sign-in surface.
- `tests/artifacts/design-audit-20260813/02-week-view.png` — public pre-change week view with clipped top controls and horizontal overflow.
- `tests/artifacts/design-audit-20260813/03-event-editor.png` — public pre-change editor with its primary action below the viewport.
- `tests/artifacts/design-audit-20260813/04-redesign-start.png` — current-source two-panel start screen with the supplied real YNX logo.
- `tests/artifacts/design-audit-20260813/05-redesign-week.png` — current-source desktop week view with the full command bar visible.
- `tests/artifacts/design-audit-20260813/06-redesign-editor.png` — current-source structured editor and persistent review action.
- `tests/artifacts/design-audit-20260813/12-redesign-mobile-final.png` — 390×844 week view after moving tools to the bottom bar.
- `tests/artifacts/design-audit-20260813/15-redesign-mobile-editor-final.png` — 390×844 event editor after the toast hit-target fix.
- `tests/artifacts/calendar-desktop.png` and `tests/artifacts/calendar-mobile.png` — independent checked-in browser proof generated after the redesign.

## Visual system decisions

- The supplied transparent YNX raster is cropped only to transparent bounds, resized proportionally, and rendered with `object-fit: contain`; it is not stretched or reconstructed.
- Klein blue is reserved for identity, selected dates, focus and primary actions. Neutral light/dark surfaces carry most of the interface so the product reads as a professional scheduling tool rather than a branded landing page.
- Borders, section numbers, compact uppercase labels and consistent control heights provide hierarchy without decorative cards or gradients.
- Desktop and mobile expose the same core actions. Mobile relocates secondary actions; it does not silently remove them.

## Accessibility checks and limits

- All interactive controls retain accessible names, keyboard focus treatment, forced-colors support and reduced-motion behavior; browser proof reported zero console errors.
- The event sections use named `section` regions and the submit action stays reachable without scrolling the page behind the dialog.
- Screenshot inspection cannot prove screen-reader announcement order, every translated string, switch-control behavior, or production Wallet callback behavior. Those remain separate functional acceptance gates.

## Remaining release limits

- The new explanatory section copy still requires complete translation across all 12 Web catalogs; English remains the default and no new Chinese-first surface was introduced.
- Current-source native packages, production signing and real public two-user Wallet collaboration are not yet accepted.
- Public deployment and an exact-build ComputerControl pass must follow before this redesign can be described as public evidence.
