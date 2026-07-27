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

Current protected runtime commit:
`52c70f74220df06208b6a415580a5a879c4a8cb8`.

- `npm run check`: 15 unit/integration/race/replay/security tests, deterministic
  service smoke, and dependency-independent Search secret scan.
- `npm run test:e2e`: 6 Chromium Playwright scenarios.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- `UI_DESIGN_AUDIT.md`: manual visual/a11y/RTL review and fixed issues.
- `src/network.js` and crawler tests: unsafe outbound destinations and DNS
  rebinding are rejected before fetch and persist failed/backoff state.
- Source Registry v3 tests: missing governance fails closed, legacy sources are
  disabled, and AI context requires explicit AI retrieval rights.

The root repository secret-scan invocation from 2026-07-27 is not accepted as
proof because `rg` was unavailable while that script printed success. The Search
product-local scanner is the valid evidence for this checkpoint.

## Release and integration records

- `../../../product-release.json`: truthful local, staging and public states.
- `../../../public-product-metadata.json`: Website/SEO handoff.
- `../../../release/integration/search-contract.json`: proposed canonical Search
  source/result/auth/event/error contract.
- `../../../docs/integration/`: handoff, dependency acceptance and cross-product
  negative test vectors.
- `../../../.ai-bridge/full-goal-coverage.json`: complete active goal matrix.

Historical staging remains deployed at
`d68b5d89c0d2e92744bf634c55b776397ec8f896`; it does not prove deployment of the
current protected runtime commit.
