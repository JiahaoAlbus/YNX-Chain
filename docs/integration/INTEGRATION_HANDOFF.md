# YNX Exchange integration handoff

## Release truth

- Owner: `07-exchange`
- Runtime source commit: `42f2f48e1ecc3816337d4c6f83ab4cf230f4a01d`
- Contract: `release/integration/exchange-contract.json`
- State schema: `9`
- Current stage: `FREEZE` in progress
- Central integration: not accepted
- Shared Testnet: not verified
- Public runtime/download: not deployed or hosted

The runtime commit is pushed to `codex/final-exchange` and was verified equal to its upstream at the time of this handoff. This document does not turn local evidence into central, public, signed or store status.

## Exchange-owned authority

Exchange owns deterministic Spot order state, available/reserved subaccount accounting, actual fills, maker/taker fees, the persisted execution sequence/hash chain, and enforcement of Quant mandates and strategy kill state. It does not own Wallet identity, chain finality, Oracle facts, Bridge state, the canonical billing ledger, public Website state or shared Testnet acceptance.

## Frozen local contracts

- Wallet tuple: product `exchange`, client `ynx-exchange-v1`, bundle `com.ynxweb4.exchange`, callback `ynxexchange://wallet-auth/callback`, chain `ynx_6423-1`.
- Required scopes: `exchange:ai`, `exchange:deposit`, `exchange:read`, `exchange:trade`, `exchange:withdrawal-review`.
- Session transport: Bearer header only; query tokens and browser-persisted legacy sessions are rejected.
- Action authorization: domain-separated Wallet signatures plus idempotency keys; protected HTTP calls also require the matching Gateway scope.
- Quant kill: `ynx-quant-strategy-kill-v1`; persistent nonce-domain revocation plus atomic subaccount-market mass cancel. A mass-cancel signature is not interchangeable.
- Quant aggregate capital: sum of open execution notional for the exact subaccount and nonce domain; persisted across restart.
- Quant pause/resume: unavailable and fail closed. Resumption after kill requires a newly signed mandate with a new nonce domain.
- Health/version: `/health`, `/ready`, `/metrics`, `/version`.
- Streams: persisted Market/User/Drop Copy sequence with public/private redaction boundaries.

## Local verification at the runtime commit

Passed on 2026-07-27:

- `go test ./internal/exchangeproduct -count=1`
- `go test -race ./internal/exchangeproduct -count=1`
- `go vet ./internal/exchangeproduct ./apps/exchange/server`
- source-bound Darwin ARM64 build with `-trimpath` and BuildCommit ldflag
- `npm --prefix apps/exchange test`
- `npm --prefix apps/exchange run test:browser`
- `npm --prefix apps/exchange run smoke`
- `npm --prefix apps/exchange run validate:release`

Local artifact evidence: `evidence/artifacts/exchange-darwin-arm64-42f2f48.txt`. It is unsigned and unhosted.

## Integration acceptance required

### Wallet/Auth owner

Accept the exact registry tuple and prove session introspection plus protected-action verification for valid, wrong-product, wrong-bundle/device, scope widening, expiry and revoke vectors. Until then Exchange remains fail closed and `integratedCentral=false`.

### Chain/Indexer/operator owners

Provide an approved custody address and committed Indexer transfer proof contract. Exchange credits only authoritative transfers at the configured confirmation threshold. Withdrawal stops at `reviewed_pending_operator_broadcast`; an approved broadcaster and receipt proof remain external.

### Integration owner

Execute `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`, freeze any conflicting scope/event/error definitions, and bind accepted evidence to the same source commit. Two-user shared Testnet acceptance cannot be recorded while Margin/Perp, UltraLiquidity and solvency are absent.

### Security/SRE owner

Verify artifact/SBOM/provenance, secret handling, remote backup/restore, observability/alerts and deployment boundaries. The current local artifact is not production signed or reproducible evidence.

### Website owner

Consume `apps/exchange/public-product-metadata.json`, preserve every release boolean, and publish only after runtime/public URLs and accepted brand assets are verified. A product page and a public runtime are separate states.

## Known blockers and exact recovery conditions

- Central Wallet/Gateway: recover when registry and action verification accept the frozen tuple and vectors.
- Historical migration: recover when immutable byte fixtures from each shipped v2–v8 source commit are available; current v1/v8 tests are generated vectors, not full history proof.
- Shared repository tests: recover when missing contract artifacts and key-permission assumptions in non-Exchange packages are fixed by their owners.
- CI visibility: recover when GitHub Actions queries stop timing out and a run for the final branch is directly inspected.
- Public/staging/artifacts: recover when stateful deployment, hosting, signing and monitoring authority are provided.

## Next Exchange-owned engineering priorities

1. Add a separately signed persistent pause/resume state machine or keep it explicitly unsupported.
2. Add atomic heterogeneous batch execution and cancel-vs-match stress vectors.
3. Implement native Margin/Perp/risk primitives before exposing leverage/funding methods.
4. Build UltraLiquidity adapters and total-execution-cost routing without synthetic liquidity.
5. Add solvency/liability proof and withdrawal-capacity evidence.
6. Complete real historical migration fixtures, rollback/export and remote restore drill.
