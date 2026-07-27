# YNX Trust Center Integration Handoff

## Release identity

- Product: `15 | YNX Trust Center`
- Product client: `ynx-trust-center-v1`
- Source branch: `codex/final-trust-center`
- Runtime source commit: `4e78f47e9b2dedee71c12adf9790374412b45356`
- Current phase: `FREEZE`
- Goal status: `Active`

This handoff describes a locally implemented and tested candidate. It does not claim central integration, Testnet deployment, public hosting, production signing or store release.

## Product boundary

YNX Trust Center owns request-validity checks, bounded evidence presentation, independent review workflow, notice, appeal, correction, finite sourced labels and aggregate transparency. It is not an asset controller, punishment engine, custody service or AI judge.

Native YNXT freeze, seizure, blacklist, confiscation or transfer requests are rejected. Actual product or chain actions remain owned by their canonical product, Chain Core and Governance boundaries.

## Canonical dependencies

| Owner | Dependency | Required state |
|---|---|---|
| 02 Wallet/Auth | Product-scoped session, device binding, ordered scopes, expiry and revoke | Accepted contract and shared-Testnet registration |
| 14 AI | Explanation-only provider route with explicit consent and no mutation tools | Provider-backed evidence, optional for core due process |
| 26 Data Fabric | Canonical Trust events and billing-neutral audit ingestion | Contract acceptance |
| 28 Website | `/trust-center` route, public metadata, support/privacy/security/status links | Publish only after release gates |
| 29 Integration | Canonical Gateway registration, route mapping and shared-Testnet vectors | Required before `integratedCentral=true` |
| 30 Security/SRE | Backup/restore, artifact provenance, release and deployment controls | Required before public release |
| 31 Governance | Authoritative request/review/appeal/transparency state | Required for shared-Testnet authority |

## Frozen product contract

The machine-readable contract is:

- `release/integration/trust-center-contract.json`

The contract freezes:

- client ID and Wallet callback;
- session/device/client headers;
- least-privilege Trust scopes;
- product-to-central route mapping;
- canonical event candidates;
- fail-closed error semantics;
- state format v2 integrity requirements;
- health response requirements;
- truthful nine-stage release state.

## Persistence and recovery change

Runtime commit `4e78f47e9b2dedee71c12adf9790374412b45356` upgrades the product-local Trust snapshot from version 1 to version 2.

Version 2:

- computes a SHA-256 integrity seal over the canonical JSON snapshot with the seal field blanked;
- verifies the seal before admitting persisted state;
- compares seals in constant time;
- rejects offline field modification on restart;
- preserves and atomically reseals a decodable version-1 snapshot;
- writes mode-`0600` state;
- reports `stateFormatVersion=2` and `tamperEvidentPersistence=true` through `/health`.

This is local tamper evidence, not a signature by an external trust anchor and not a substitute for encrypted backups, remote attestation or independent audit.

## Verification at this checkpoint

Passed:

```text
go test -race ./internal/trustproduct ./apps/trust-center
go test ./internal/trustgateway ./internal/trustproduct ./apps/trust-center
./apps/trust-center/check.sh
```

The repository-wide `go test ./...` did not pass because generated Solidity artifacts are absent and unrelated product permission fixtures are sensitive to the host `umask`. No Trust product regression was observed. The Trust Gateway permission fixture in this branch was made deterministic with an explicit unsafe-mode `chmod` and now passes.

## Shared-Testnet vectors

Integration must execute:

- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`

The minimum acceptance set includes:

1. exact product/device/session binding;
2. wrong-device rejection;
3. illegal native-asset-control rejection;
4. overbroad-scope rejection;
5. evidence visibility requirement;
6. reviewer and appeal-reviewer separation;
7. false-positive correction;
8. offline state-tamper rejection;
9. version-1 migration;
10. central-authority unavailable behavior;
11. AI no-mutation proof;
12. privacy-preserving transparency output.

## Known open security item

The product currently persists central session scopes, but the next autonomous slice must enforce required scopes on every product-local and authoritative proxy route. Integration must not accept this candidate as centrally integrated until route-level scope enforcement and negative tests pass.

## Required Integration actions

1. Review and freeze `ynx-trust-center-v1` in the canonical product registry.
2. Approve only the scopes in the machine-readable contract; no wildcard scope.
3. Route the frozen `/app/trust/**` and `/app/governance/**` paths to canonical owners.
4. Run all cross-product vectors against the shared Testnet.
5. Preserve fail-closed behavior when any authority dependency is unavailable.
6. Record exact source/release commits, request IDs, transaction or event evidence, and recovery evidence.
7. Do not set `integratedCentral`, `deployedPublic` or any signing/store state without direct evidence.

## Current release truth

- `implementedLocal`: true
- `testedLocal`: true
- `installedLocal`: false
- `integratedCentral`: false
- `deployedStaging`: false
- `deployedPublic`: false
- `downloadHosted`: false
- `productionSigned`: false
- `storeReleased`: false
