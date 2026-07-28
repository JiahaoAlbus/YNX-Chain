# YNX Monitor Evidence Index

Status: Active, phase `PROTECT`  
Product owner: `13-monitor`  
Implementation source: `f3ab30068bc6ae3358cc2e6102ec3735abeae70f`
Branch: `codex/final-monitor`  
Last updated: 2026-07-28

This index separates source-bound local evidence from central, Testnet, artifact, hosted, and public evidence that does not yet exist.

## Source and recovery evidence

| Evidence | Direct location | Result |
|---|---|---|
| Exact worktree and branch takeover | `.ai-bridge/execution-log.jsonl` — `takeover-inventory` | Passed |
| Implementation checkpoint | Git commit `f3ab30068bc6ae3358cc2e6102ec3735abeae70f` | Committed and pushed |
| Local/upstream equality | `product-release.json` → `verifiedLocal.remoteProtection` | Equal at source commit |
| Full requirement coverage | `.ai-bridge/full-goal-coverage.json` | Active; incomplete items retained |
| Decisions and boundaries | `.ai-bridge/decisions.md` | Current |
| Dependency questions | `.ai-bridge/open-questions.md` | Open; no secrets requested |

## Runtime and security evidence

| Capability | Implementation | Tests / evidence |
|---|---|---|
| Scoped RBAC | `apps/monitor/server/auth.ts`, `apps/monitor/src/api.ts` | `apps/monitor/server/rbac.test.ts` |
| Wallet challenge replay rejection | `apps/monitor/server/app.ts`, `apps/monitor/server/store.ts` | `apps/monitor/server/auth.test.ts` |
| Exact Origin and session-bound CSRF | `apps/monitor/server/auth.ts`, `apps/monitor/server/app.ts`, `apps/monitor/src/api.ts` | `MON-ORIGIN-CSRF-001`; `apps/monitor/server/auth.test.ts` |
| Signed redacted public status | `apps/monitor/server/public-status.ts`, `apps/monitor/server/app.ts` | `MON-PUBLIC-REDACTION-001`, `MON-PUBLIC-INTEGRITY-001`; `apps/monitor/server/public-status.test.ts` |
| Versioned incident lifecycle | `apps/monitor/server/store.ts`, `apps/monitor/server/app.ts` | `apps/monitor/server/incident-lifecycle.test.ts` |
| Integrity-protected restart | `apps/monitor/server/store.ts` | `apps/monitor/server/store.test.ts` |
| Typed backup and restore evidence | `apps/monitor/server/store.ts`, `apps/monitor/server/app.ts` | `apps/monitor/server/recovery-lifecycle.test.ts` |
| Non-executing rollback proposal | `apps/monitor/server/store.ts`, `apps/monitor/server/app.ts` | `apps/monitor/server/recovery-lifecycle.test.ts` |
| Capability-gated responsive UI | `apps/monitor/src/App.tsx` | `apps/monitor/tests/*.spec.ts` |

## Verification results

| Gate | Command | Result |
|---|---|---|
| Monitor tests | `cd apps/monitor && npm test` | 31 passed, 0 failed; 13 public-status cases |
| Production build | `cd apps/monitor && npm run build` | Passed |
| Desktop/mobile browser E2E | `cd apps/monitor && npm run test:e2e` | 8 passed, 0 failed |
| Production dependency audit | `cd apps/monitor && npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| Real-service smoke | `cd apps/monitor && npm run smoke` | Failed because all eight central dependency endpoints were unavailable; no Testnet/healthy claim |
| Repository preflight | `go test ./...` | Failed outside `13-monitor`; details in `product-release.json` |

The failed repository preflight is not hidden or attributed to Monitor. It includes signing-key permission failures in consensus/faucet/trust owners and missing compiled EVM fixtures in BFT/consensus tests. This thread did not modify those owners' code.

## Contract and integration evidence

| Package | Location | State |
|---|---|---|
| Candidate integration contract | `release/integration/monitor-contract.json` | Source-bound; not frozen |
| Integration handoff | `docs/integration/INTEGRATION_HANDOFF.md` | Source-bound |
| Cross-product vectors | `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json` | Source-bound |
| Dependency acceptance | `docs/integration/DEPENDENCY_ACCEPTANCE.md` | Open |
| Product release record | `product-release.json` | Active / `PROTECT` |

## Evidence not yet available

No direct evidence currently supports any of the following claims:

- accepted central Wallet/Auth or other owner contracts;
- shared Testnet incident, Quant kill-switch, provider/region failure, restore, or rollback drill;
- hosted private operator workspace or redacted public-status endpoint;
- GitHub Actions run, GitHub Release, Monitor artifact, SBOM, provenance, immutable download, signing, installation, or cold start;
- staging or public runtime deployment;
- production signing or store release.

These states remain false or blocked in `product-release.json` and `.ai-bridge/full-goal-coverage.json`.
