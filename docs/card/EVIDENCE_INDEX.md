# YNX Card Evidence Index

Product: `YNX Card` (`06-card`)  
Branch: `codex/final-card`  
Recovered source baseline: `d79872f5df4da0566e11ef40e5314ea68d9846f4`

## Source and release truth

| Evidence | Path |
|---|---|
| Product release state | `apps/card/product-release.json` |
| Public metadata handoff | `apps/card/public-product-metadata.json` |
| Canonical integration contract | `release/integration/ynx-card-contract.json` |
| Integration handoff | `docs/integration/INTEGRATION_HANDOFF.md` |
| Dependency acceptance | `docs/integration/DEPENDENCY_ACCEPTANCE.md` |
| Release notes | `docs/card/RELEASE_NOTES.md` |
| Feature completion matrix | `docs/card/FEATURE_COMPLETION_EVIDENCE.md` |

## Security and privacy

| Evidence | Path |
|---|---|
| Threat model | `docs/card/THREAT_MODEL.md` |
| Account lifecycle implementation | `internal/cardproduct/data_lifecycle.go` |
| Account lifecycle tests | `internal/cardproduct/data_lifecycle_test.go` |
| Gateway scope verification | `internal/cardproduct/auth.go` |
| State integrity and no-op persistence | `internal/cardproduct/store.go` |
| Backup validation/normalization | `internal/cardproduct/backup.go` |
| Product security scanner | `apps/card/scripts/security-check.mjs` |

## Supply chain

| Evidence | Path / value |
|---|---|
| Deterministic generator | `apps/card/scripts/generate-sbom.mjs` |
| CycloneDX npm SBOM | `release/card/sbom-npm.cdx.json` |
| SBOM provenance | `release/card/sbom-npm.provenance.json` |
| Package lock SHA-256 | `651350befa33df3a56b015833527f535e6cf15f9f7a93c91904d821cd5e37e8f` |
| SBOM SHA-256 | `90b5c06d17bba8460554ec3d24a5e7f7b75a7fc811bb8329535396a45cf6654f` |
| Component count | 533 |
| Repository Go module inventory | `release/go-module-inventory.json` (repository-wide, not Card-specific closure) |

## Operations, recovery and performance

| Evidence | Path |
|---|---|
| Operator manual | `docs/card/OPERATIONS.md` |
| Migration compatibility | `docs/card/MIGRATION_COMPATIBILITY.md` |
| Observability contract | `docs/card/OBSERVABILITY.md` |
| SLO/capacity plan | `docs/card/SLO_CAPACITY_PLAN.md` |
| Benchmark source | `internal/cardproduct/performance_test.go` |
| Unit-economics truth model | `docs/card/UNIT_ECONOMICS.md` |
| Backup/restore implementation | `internal/cardproduct/backup.go` |
| Backup/restore CLI | `internal/cardproduct/cmd/ynx-card-product-admin` |

## Verification evidence

| Verification | Current direct outcome |
|---|---|
| Card Go tests | Passed |
| Card race tests | Passed |
| Card Go vet | Passed |
| Product security check | Passed |
| Deterministic SBOM generation | Passed, 533 components |
| Local benchmark | Passed on Apple M2; see SLO/capacity plan |
| Repository-wide Go tests | Not green because unrelated BFT/consensus packages require a missing generated Solidity artifact |
| Exact-head GitHub Actions | Pending PR/workflow run |
| Native Android install | Not evidenced |
| Native iOS install | Not evidenced |
| Shared Testnet | Not evidenced |
| Public deployment | Not evidenced |

## Recovery memory

| Evidence | Path |
|---|---|
| Current state | `docs/agent-memory/CURRENT_STATE.md` |
| Last success | `docs/agent-memory/LAST_SUCCESS.md` |
| Next action | `docs/agent-memory/NEXT_ACTION.md` |
| Blockers | `docs/agent-memory/BLOCKERS.md` |
| Decisions | `docs/agent-memory/DECISION_LOG.md` |
| Machine-readable checkpoint | `docs/agent-memory/RECOVERY_CHECKPOINT.json` |

## Public boundary

The only canonical public product route is intended to be `https://ynxweb4.com/card`. The metadata and handoff exist in the Chain repository, but no accepted central integration, Vercel deployment or verified public page is currently evidenced. `huangjeo.com` is not a YNX product/docs/release/status/support domain; legitimate `mcpXX.huangjeo.com` service addresses are separate and must not be rewritten.
