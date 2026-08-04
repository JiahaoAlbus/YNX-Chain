# YNX Search evidence index

## Runtime and API

- Staging: <https://search-staging.43.153.202.237.sslip.io>
- Health: <https://search-staging.43.153.202.237.sslip.io/api/health>
- `staging/health.json`: exact deployed commit and dependency availability.
- `staging/health-headers.txt`: TLS reverse-proxy response/security headers.
- `staging/search-empty.json`: approved-source corpus is empty and returns zero
  results without fabricated coverage.

## Visual evidence

`ui/` contains exact-viewport Playwright captures for desktop light/dark
success, mobile empty, 150% mobile text, Arabic RTL tablet, and failure/retry.
`staging/` contains 1440×900 and 390×844 captures of the deployed empty-index
preview. Each visual is paired with an assertion in `test/e2e/search.spec.mjs`
or an HTTPS smoke response.

## Verification

- `npm run check`: 12 unit/integration/race/replay tests plus API smoke.
- `npm run test:e2e`: 6 Chromium Playwright scenarios.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- `UI_DESIGN_AUDIT.md`: manual visual/a11y/RTL review and fixed issues.
