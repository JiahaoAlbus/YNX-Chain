# YNX Card Feature Completion Evidence

Product: `06-card` / `YNX Card`  
Branch: `codex/final-card`  
Recovered source baseline: `d79872f5df4da0566e11ef40e5314ea68d9846f4`  
Data-lifecycle implementation: `719337289bfa9c28bee3acd86279b1bac61e9815`

## Evidence rules

A row marked `local verified` means the implementation exists in this branch and the listed local verification passed. It does not mean centrally accepted, shared-Testnet verified, staged, public, production-signed or store-released. Public and release flags remain false unless direct evidence exists.

## Product capability matrix

| Capability | State | Primary evidence | Verification |
|---|---|---|---|
| Provider-neutral issuer interface | Local verified | `internal/cardproduct/provider.go` | Card package tests |
| Honest unavailable provider/readiness | Local verified | Provider health and `/ready` | Card server/provider tests |
| Deterministic sandbox issuance | Local verified, test-only | Sandbox provider and application lifecycle | Card service tests |
| Application and Card lifecycle | Local verified | Apply, activate, freeze, unfreeze, replace, close | Service and HTTP tests |
| Spending controls | Local verified | Spend/online/international/ATM/MCC/country controls | Service and HTTP tests |
| Signed provider events | Local verified | Signature, key ID, timestamp, replay and relationship rules | Positive/negative provider event vectors |
| Gateway assertion binding | Local verified | Exact identity, route, digest, device, scope, nonce and expiry checks | Auth and server tests |
| Dedicated account-delete authority | Local verified | `card:data:delete` route-specific scopes | HTTP negative/success lifecycle test |
| Account export | Local verified | `ynx.card.account-export.v1` redacted projection | Export redaction test |
| Bounded retention | Local verified | Notifications, AI, idempotency, nonce, orphan replay and receipts | Retention boundary tests |
| Fail-closed account deletion | Local verified | Provider closure before erasure, idempotent receipt | Deletion and persisted-state tests |
| Audit-chain preservation | Local verified | HMAC state plus rehash after export/deletion redaction | Backup validation and lifecycle tests |
| Backup/verify/restore/rollback | Local verified | `ynx.card.backup.v1` and admin CLI | Backup/restore test suite |
| Corrupt-primary quarantine/cold restore | Local verified | Admin restore paths | Backup/restore tests |
| Structured observability | Local verified | Correlation headers, JSON logs, bounded Prometheus metrics | Observability tests |
| Review-only AI drafts | Local verified adapter boundary | AI run/review model | AI workflow tests; central AI not accepted |
| Mobile source and localization | Source verified at recovery checkpoint | Expo Android/iOS source, 12 locales, Arabic RTL | Prior npm tests/typecheck/bundle check |
| Deterministic npm SBOM | Local verified | `release/card/sbom-npm.cdx.json` | Regeneration returns same SHA-256 |
| Capacity baseline | Local benchmark only | `performance_test.go` and SLO plan | Apple M2 microbenchmarks |

## Data lifecycle negative evidence

The lifecycle test suite proves:

1. Account export omits eligibility references, provider application references, provider Card IDs, provider event IDs, related event IDs and request/trace correlation IDs.
2. Safe account-owned metadata such as Last4 and merchant description remains available where appropriate.
3. Account deletion closes every open provider Card before mutating local state.
4. A provider closure failure returns an error without local erasure.
5. Successful deletion removes eligibility, applications, Cards, events, disputes, notifications, AI runs, account idempotency and provider replay IDs.
6. Raw account, provider Card and provider event identifiers are absent from the persisted snapshot after deletion.
7. Matching audit records are pseudonymized, correlation IDs are removed, and the entire audit hash chain remains valid.
8. Repeating deletion with the same idempotency key returns the original receipt; a different key conflicts while the receipt is retained.
9. Default Card scopes receive HTTP 401 for the delete route; the exact `CardDeleteScopes` assertion succeeds.
10. Routine retention deletes expired bounded records but preserves Card and financial event history.
11. Incomplete or unsafe retention policy values fail service initialization.
12. Older snapshots missing deletion receipts normalize safely without changing the state version.

## Verification commands and outcomes

| Command | Outcome |
|---|---|
| `go test ./internal/cardproduct/...` | Passed after data lifecycle, main merge and no-op persistence optimization |
| `go test -race ./internal/cardproduct/...` | Passed after data lifecycle and main merge |
| `go vet ./internal/cardproduct/...` | Passed |
| `npm run security-check` in `apps/card` | Passed |
| `npm run generate-sbom` in `apps/card` | Passed; 533 components |
| `go test -run ^$ -bench Benchmark -benchtime=1s -benchmem ./internal/cardproduct` | Passed; state read ~54.2 µs/op, account export ~145.5 µs/op on Apple M2 |
| `go test ./...` | Non-green only in unrelated BFT/consensus packages due missing generated Solidity artifact; Card packages passed |

## Supply-chain evidence

- CycloneDX: `release/card/sbom-npm.cdx.json`
- SBOM provenance: `release/card/sbom-npm.provenance.json`
- Package lock SHA-256: `651350befa33df3a56b015833527f535e6cf15f9f7a93c91904d821cd5e37e8f`
- SBOM SHA-256: `90b5c06d17bba8460554ec3d24a5e7f7b75a7fc811bb8329535396a45cf6654f`
- Generator SHA-256: `1abc1a4461d4a476f4b98266f84dbd6f8e5c428b421afebabec07badeeba5432`
- Inventory count: 533 npm package-lock entries.

The npm SBOM covers `apps/card`. The repository-wide Go module inventory exists separately, but a Card package-specific Go dependency closure and independent dependency/license review remain open.

## Integration and deployment truth

| State | Value | Reason |
|---|---:|---|
| `implementedLocal` | true | Direct source and tests |
| `testedLocal` | true | Card-owned tests and gates passed |
| `builtLocal` | partial | Go/admin and Expo bundle evidence; current native install artifacts absent |
| `installedLocal` | false | No current native install/cold-launch evidence |
| `migrationVerified` | true | Versioned backup migration and compatibility tests |
| `restoreVerified` | true | Verified rollback, quarantine and cold restore tests |
| `integratedCentral` | false | Owners 02/14/15/26/29/30 have not accepted/deployed exact contract |
| `testnetVerified` | false | No shared Testnet E2E bound to this SHA |
| `deployedStaging` | false | No staging deployment evidence |
| `deployedPublic` | false | No public runtime evidence |
| `releasePublished` | false | No final GitHub release bound to accepted SHA |
| `downloadHosted` | false | No hosted APK/IPA/service artifact |
| `productionSigned` | false | No production signing operation |
| `storeReleased` | false | No App Store/Play release |
| `mainnetReleased` | false | Testnet Preview only |

## Remaining gates

- Open/review/merge PR and inspect exact-head Actions.
- Central acceptance of route-specific delete scope and all integration vectors.
- Official issuer selection and provider-specific webhook/closure contract.
- Encrypted off-host backup, scheduled retention and timed recovery evidence.
- Go package-specific SBOM, audit triage, DAST and independent security review.
- Native mobile install/cold-start/deep-link evidence.
- Shared Testnet, staging, artifacts, release provenance and public website closure.

No remaining item above is converted into a false `externalBlocked` state merely because another owner will eventually accept it; autonomous Card work continues until only credentials, legal approval, signing authority or irreversible production operations remain.
