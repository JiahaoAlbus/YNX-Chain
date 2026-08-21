# YNX Calendar evidence index

Latest local candidate source: `df302c542e34654445e70b8aa6a81c2b2525d9de`
Public Web runtime source (candidate not yet published): `828120e6d81efaf874a930793660e185a394ba4f`

| Evidence area | Authoritative file or command | Status |
|---|---|---|
| Release truth | `apps/calendar/product-release.json`, `product-release.json` | current-source states recorded; public/release states remain false where unproved |
| Public metadata | `public-product-metadata.json` | Website and exact-build Testnet Web runtime verified; current-source native downloads absent |
| Integration contract | `release/integration/calendar-contract.json` | local-tested proposal; central acceptance pending |
| Cross-product vectors | `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json` | CAL-X-001 through CAL-X-013 |
| Dependency acceptance | `docs/integration/DEPENDENCY_ACCEPTANCE.md` | central owners and recovery conditions recorded |
| Integration handoff | `docs/integration/INTEGRATION_HANDOFF.md` | current runtime and recovery boundary recorded |
| Website handoff | `docs/integration/WEBSITE_INTEGRATION_HANDOFF.md` | `/dapp/calendar` and direct Calendar runtime public; auxiliary route probes continue |
| Full-goal coverage | `.ai-bridge/full-goal-coverage.json` | machine-readable ACTIVE coverage |
| Runtime implementation | `internal/calendar/`, `apps/calendar/` | implementedLocal true |
| State operator | `apps/calendar/statectl/main.go` | local-tested backup/restore CLI |
| Recovery tests | `internal/calendar/store_backup_test.go` | pass |
| Operations | `apps/calendar/OPERATIONS.md` | backup, restore, rollback and incident runbook |
| Migration | `apps/calendar/MIGRATION_COMPATIBILITY.md` | state schema 2, schema-zero/one forward migration and future fail-closed |
| Canonical events | `internal/calendar/service.go`, `TestCanonicalOutboxIsTransactionalPrivateReplaySafeAndPersistent`, `TestCanonicalOutboxOverflowAbortsCalendarMutation` | local transactional outbox pass; Mail/Data Fabric transport pending |
| RSVP collaboration | `internal/calendar/service.go`, `TestRSVPCommentIsVersionedIdempotentAndPrivacyBounded` | bounded comments, organizer notification, version conflict and idempotent replay pass locally; public candidate proof pending |
| All-day recurrence regression | `apps/calendar/tests/browser-proof.cjs`, `apps/calendar/tests/artifacts/calendar-desktop.png`, `apps/calendar/tests/artifacts/calendar-mobile.png` | late-night all-day range normalization and rendered recurrence verified in desktop/mobile browser proof |
| Day and recurring-exception views | `apps/calendar/web/app.js`, `apps/calendar/tests/browser-proof.cjs`, `apps/calendar/tests/artifacts/calendar-desktop-day.png`, `apps/calendar/tests/artifacts/calendar-desktop-agenda.png` | dedicated single-day grid plus occurrence-only cancellation across Day and Agenda pass locally; public runtime still excludes this candidate |
| Shared permission history | `internal/calendar/service.go`, `internal/calendar/service_test.go`, `apps/calendar/web/app.js`, `apps/calendar/tests/browser-proof.cjs`, `apps/calendar/tests/artifacts/calendar-shared-permission-history.png` | owner/viewer/editor grants, role changes and revocation are versioned and restart-persistent; history is owner-only and redacted from non-owner/export views; real browser viewer-to-editor proof passes locally |
| Private event redaction | `internal/calendar/service.go`, `internal/calendar/service_test.go`, `apps/calendar/tests/browser-proof.cjs`, `apps/calendar/tests/artifacts/calendar-private-event-redaction.png` | unauthorized shared viewers receive Busy in list, single-event and export views; privacy-sensitive fields are cleared, comments are blocked and real-browser seeded secrets remain absent; public runtime still excludes this candidate |
| Completion evidence | `apps/calendar/FEATURE_COMPLETION_EVIDENCE.md` | local status and remaining gates |
| UI audit | `apps/calendar/UI_DESIGN_AUDIT.md` | existing UI evidence |
| Observability | `internal/calendar/observability.go`, `apps/calendar/OBSERVABILITY.md` | local health/readiness/version/request-ID/metrics pass; traces, dashboard and alerts remain central dependencies |
| SLO/capacity | `apps/calendar/SLO_CAPACITY_PLAN.md` | local measurements and required production benchmarks |
| Unit economics | `apps/calendar/UNIT_ECONOMICS.md` | measurement model; no fabricated cost claims |
| Release notes | `apps/calendar/RELEASE_NOTES.md` | current-source changes and boundaries |
| Agent recovery | `docs/agent-memory/` | branch checkpoint and next action |

## Verification commands

```sh
go test ./internal/calendar ./apps/calendar/statectl
go test -race ./internal/calendar
go vet ./internal/calendar ./apps/calendar/statectl
npm --prefix apps/calendar test
npm --prefix apps/calendar run test:release
npm --prefix apps/calendar run build
npm --prefix apps/calendar run build:statectl
npm --prefix apps/calendar run smoke
npm --prefix apps/calendar run browser:proof
```

## Public evidence rule

`ynxweb4.com` remains the official product/docs/status/support authority. The temporary direct Testnet runtime at `calendar-testnet.43.153.202.237.sslip.io` is valid exact-build operational evidence and must be visibly classified as a Testnet preview, not a replacement brand or production domain. `huangjeo.com` is the Founder website; valid `mcp36.huangjeo.com` references are MCP infrastructure only.

A Website handoff, local screenshot, successful build, historical release, or HTTP 200 is not proof of current public deployment. Current-source public proof requires the Website deployment commit, canonical page content, release-state truth, route probes and immutable current-source artifact links where applicable.
