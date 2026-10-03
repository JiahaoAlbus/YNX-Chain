# Finance observed timestamp calendar integrity

Inherited branch `codex/exchange-sso-cookie-binding-20261002`, parent `0bd91b0e3c77687b7f0a6664967f13676aa5dfbb`.

## Executed defect and correction

The new actual Chrome regression failed before the app correction: source timestamp `2026-02-30T00:00:00Z` appeared as `Mar 2, 2026, 8:00 AM`. Plain Date.parse normalized an impossible observation date into a plausible financial date.

The ordinary product date formatter now accepts only string RFC3339 timestamps with explicit timezone, valid date and time components, 1–9 fractional digits when present, and a real Gregorian calendar date. Invalid, locale-dependent, array/numeric and timezone-free values display the existing localized `dateUnavailable` text; no alternative date is invented. Legal leap days, offsets and nanosecond source timestamps continue rendering. Source payloads are not changed, no ordering or transaction state is inferred, and shared authorization is untouched.

## Validation

- Actual Chrome overview-source suite: 5/5 PASS, 4.128 seconds. New regression covers nine invalid source values across portfolio observation, activity and Pay receipt dates, and three valid timestamp forms. Existing statement owner/period fencing, unavailable sources, overview/privacy validation and explicit refresh recovery remain passing. Controlled document, no network requests, one tab and no page errors.
- Owned save/read/product-response suites: 25/25 PASS, 2.378 seconds, including actual Chrome UTF8 stream/export recovery checks. This does not claim actual public identity or upstream assets.
- Node syntax and `git diff --check`: PASS.

## Release truth

Only ordinary Finance UI formatting and direct tests changed. This is not an authority, backend, shared protocol, package, deployment or installer update. Final asset graph and source-bound public runtime still require the existing release owner. Real account approval, Product Session v2 and public financial business acceptance are not promoted by controlled browser rendering.
