# YNX Monitor Evidence Index

Status: Active, phase `PROTECT`  
Product owner: `13-monitor`  
Implementation source: `5914e02134cd17ad20c6d8c9846864861cdfd4a3`
Branch: `codex/final-monitor`  
Last updated: 2026-07-29

This index separates source-bound local evidence from central, Testnet, artifact, hosted, and public evidence that does not yet exist.

## Source and recovery evidence

| Evidence | Direct location | Result |
|---|---|---|
| Exact worktree and branch takeover | `.ai-bridge/execution-log.jsonl` — `takeover-inventory` | Passed |
| Implementation checkpoint | Git commit `5914e02134cd17ad20c6d8c9846864861cdfd4a3` | Committed; push and remote equality verified at final checkpoint |
| Local/upstream equality | `product-release.json` → `verifiedLocal.remoteProtection` | Equal at protected implementation source |
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
| Threat model and trust boundaries | `docs/security/MONITOR_THREAT_MODEL.md` | Source-bound local baseline |
| Locked dependency and license review | `apps/monitor/scripts/supply-chain-gate.mjs` | `release/monitor/security/dependency-review.json`, `THIRD_PARTY_NOTICES.md` |
| Credential and SAST gate | `apps/monitor/scripts/supply-chain-gate.mjs` | 690 tracked text files / 12 production source files; 0 findings |
| CycloneDX SBOM | `release/monitor/security/sbom.cdx.json` | 163 locked production packages |
| Reproducible build and artifact scan | `release/monitor/security/build-manifest.json` | Two clean builds identical; 0 prohibited artifact strings |
| Local unsigned provenance | `release/monitor/security/provenance.json` | Explicitly non-hermetic, unsigned, and not a production claim |
| DAST input contract | `release/monitor/security/dast-plan.json` | Negative cases defined; no hosted target claimed |

## Verification results

| Gate | Command | Result |
|---|---|---|
| Monitor tests | `cd apps/monitor && npm test` | 35 passed, 0 failed: 31 runtime/UI plus 4 supply-chain fail-closed cases |
| Production build | `cd apps/monitor && npm run build` | Passed |
| Desktop/mobile browser E2E | `cd apps/monitor && npm run test:e2e` | 8 passed, 0 failed |
| Local supply-chain gate | `cd apps/monitor && npm run security:check` | Passed: audit 0, credential/SAST 0, 163 packages reviewed, two identical clean builds, artifact scan 0 |
| Product-specific GitHub Actions | `.github/workflows/monitor-ci.yml`, run `30418246140` | Success for `9df7d117c5d0c37f191a888acb81125ca3183b33`; CI evidence artifact `8710923775`, digest `sha256:2f2e1394d42ba5381f5cc95e7009d16f11032cacde3d6cc2f26f04a8d76e930c` |
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
- GitHub Release, hosted release artifact, signed/hosted provenance, immutable download, installation, or cold start;
- hosted DAST evidence, staging, or public runtime deployment;
- production signing or store release.

These states remain false or blocked in `product-release.json` and `.ai-bridge/full-goal-coverage.json`.
