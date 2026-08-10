# YNX Search evidence index

## Runtime and API

- Staging: <https://search-staging.43.153.202.237.sslip.io>
- Health: <https://search-staging.43.153.202.237.sslip.io/api/health>
- `staging/health.json`: historical deployed commit and dependency availability.
- `staging/health-headers.txt`: historical TLS reverse-proxy response/security headers.
- `staging/search-empty.json`: approved-source corpus is empty and returns zero
  results without fabricated coverage.

The current protected source commit is
`88ee867322ec11a243a483c04bab99676cc3416e`. Historical staging remains on
`d68b5d89c0d2e92744bf634c55b776397ec8f896`; it does not prove deployment of
the current source.

## Visual evidence

`ui/` contains exact-viewport Playwright captures for desktop light/dark
success, mobile empty, 150% mobile text, Arabic RTL tablet, and failure/retry.
`staging/` contains 1440×900 and 390×844 captures of the historical deployed
empty-index preview. Each local visual is paired with an assertion in
`test/e2e/search.spec.mjs`; staging captures remain historical evidence only.

## Verification

- `npm run check`: 31 unit/integration/recovery/observability/race/replay/security
  tests, deterministic service smoke, dependency-independent Search secret scan,
  deterministic feed verification, and recovery drill.
- `npm run test:e2e`: 6 Chromium Playwright scenarios.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- `UI_DESIGN_AUDIT.md`: manual visual/a11y/RTL review and fixed issues.
- `src/network.js` and crawler tests: unsafe outbound destinations and DNS
  rebinding are rejected before fetch and persist failed/backoff state.
- Source Registry v4 tests: missing governance fails closed, legacy sources are
  disabled, and AI context requires explicit AI retrieval rights.
- `OBSERVABILITY.md`: Request, Trace and Error correlation, bounded structured
  logs, protected metrics and central Monitor handoff.
- `SLO_CAPACITY_PLAN.md`: candidate SLOs, measurement gates and honest scaling
  boundaries.
- `capacity/local-loopback-88ee8673.json`: exact-source local loopback evidence:
  80/80 responses at concurrency 8, p50 8.82 ms, p95 22.57 ms, p99 34.03 ms,
  and 713.98 requests/second. This is not staging, public or production capacity.

The root repository secret-scan invocation from 2026-07-27 is not accepted as
proof because `rg` was unavailable while that script printed success. The Search
product-local scanner is the valid evidence for this checkpoint.

## Release and integration records

- `../product-release.json`: truthful local, historical staging and public
  states bound to the current protected source commit.
- `../../../release/search/public-product-metadata.json`: Website/SEO handoff for the canonical
  `ynxweb4.com/search` route; route deployment remains pending owner 28.
- `../../../release/integration/search-contract.json`: proposed canonical Search
  source/result/auth/event/error/observability contract v1.4.0.
- `../../../docs/integration/`: handoff, dependency acceptance and cross-product
  negative test vectors.
- `../../../.ai-bridge/full-goal-coverage.json`: active goal matrix; central
  acceptance and public claims require independent evidence.
- `../../../release/public/search/public-feed-manifest.json`: deterministic local
  feed hashes; hosting remains false until Website evidence exists.
