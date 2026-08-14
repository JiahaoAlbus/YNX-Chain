# YNX Calendar evidence index

Current product source: `31a34c5736a848eb3fa6d5d3a55ea5187654af14`
Public Web runtime source: `635f6745db8b5d4e4f00253d72fd5ab97da471ac`

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
| Migration | `apps/calendar/MIGRATION_COMPATIBILITY.md` | state schema 1, legacy normalization and future fail-closed |
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
