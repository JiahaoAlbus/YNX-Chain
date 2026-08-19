# YNX Search evidence index

## Runtime and API

- Public UI: <https://web4.ynxweb4.com/search/>
- Public health: <https://web4.ynxweb4.com/search/api/health>
- `public-testnet-a2601b6c.json`: exact source commit, service/Caddy
  boundary, authorized source inventory, public browser flow and concurrent
  request results.
- Staging: <https://search-staging.43.153.202.237.sslip.io>
- Health: <https://search-staging.43.153.202.237.sslip.io/api/health>
- `staging/health.json`: exact deployed commit and dependency availability.
- `staging/health-headers.txt`: TLS reverse-proxy response/security headers.
- `staging/search-empty.json`: historical staging evidence from before the
  public YNX-owned source inventory was approved.

## Visual evidence

`ui/` contains exact-viewport Playwright captures for desktop light/dark
success, mobile empty, 150% mobile text, Arabic RTL tablet, and failure/retry.
`staging/` contains 1440×900 and 390×844 captures of the deployed empty-index
preview. Each visual is paired with an assertion in `test/e2e/search.spec.mjs`
or an HTTPS smoke response.

## Verification

- `npm run check`: 13 unit/integration/race/replay/subpath tests plus API smoke.
- `npm run test:e2e`: 6 Chromium Playwright scenarios.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- `UI_DESIGN_AUDIT.md`: manual visual/a11y/RTL review and fixed issues.
