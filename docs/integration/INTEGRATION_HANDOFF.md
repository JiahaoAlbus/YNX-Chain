# YNX Seller Console Integration Handoff

- Product: `10 | YNX Seller Console`
- Branch: `codex/final-seller-console`
- Source commit: `9e6aea94087d02c76ee9002df8b92b3f7d55df9b`
- Stage: `FREEZE`
- Goal status: `Active`

## Frozen local contract

Seller Console uses the canonical role set `owner`, `admin`, `catalog`, `inventory`, `fulfillment`, `finance`, `support`, and `viewer`. New role assignments reject the legacy `manager` value. Snapshot v2 data migrates through the canonical role boundary and is persisted as Snapshot v5, which also initializes role-revocation records and append-only Seller integration events.

Only an owner may revoke a non-owner role. Local Seller authority is removed before the central Wallet call. A revoked account cannot be regranted until a fully bound store-scoped Wallet authorization-revocation receipt is confirmed. Missing, rejected, malformed, future-dated, cross-account, cross-product, cross-bundle, or cross-store receipts fail closed.

The local outbox persists:

- `ynx.seller.role.revoked.v1`
- `ynx.seller.authorization.revocation.updated.v1`

These records are local integration candidates only. Owner 26 Data Fabric retains canonical event ownership and has not accepted or ingested them yet.

The machine-readable contract is `release/integration/seller-console-contract.json`.

## Verified local evidence

Bound to source commit `9e6aea94087d02c76ee9002df8b92b3f7d55df9b`:

- `go test ./internal/commerce`: passed.
- `go test -race ./internal/commerce`: passed; macOS linker emitted a non-failing malformed `LC_DYSYMTAB` warning.
- `npm test` in `apps/seller-console`: passed.
- `npm run build` in `apps/seller-console`: passed and produced the local unhosted `dist/` build.
- Role-revocation tests cover owner-only access, self/owner protection, idempotent repeat, conflicting repeat, unavailable provider, mismatched receipt, store-scoped effect, regrant blocking, event binding, and restart persistence.

A full `go test ./...` preflight was attempted. Seller Commerce passed, but the repository-wide command remained red in non-Seller ownership areas: missing SampleEVMWriteCounter artifacts in BFT/Consensus and permissive-key permission assertions in Consensus TX, Faucet, and Trust. This thread did not modify those products.

The existing local smoke script probes only `/health` and `/api/capabilities`; it does not prove that source commit `9e6aea9` is the running service. Current-source `installedLocal`, `integratedCentral`, `deployedStaging`, `deployedPublic`, and `downloadHosted` remain false.

## Dependency handoff

| Owner | Required acceptance | Current state |
|---|---|---|
| 02 Wallet/Auth | Deploy `ynx-seller-v1`, exact ordered scopes, session introspection, and `POST /v1/product-authorizations/revocations` with a receipt bound to request/account/product/bundle/resource | Pending |
| 04 Pay | Authoritative settlement and refund evidence contract | Pending |
| 15 Trust Center | Dispute and appeal evidence contract | Pending |
| 26 Data Fabric | Freeze and ingest the two versioned Seller revocation outbox events idempotently | Pending |
| 13 Monitor | Health, SLO, alert and incident ingestion | Pending |
| 28 Website | Canonical `/seller-console` metadata and release route | Pending |
| 29 Integration | Shared Testnet contract freeze and end-to-end vectors | Pending |
| 30 Security/SRE | Artifact, backup, security and release gate | Pending |

## Truth boundaries

- Local role revocation is authoritative only for Seller Console's local store authorization state.
- A local Outbox event is not evidence that Wallet/Auth revoked sessions or Data Fabric ingested a canonical event.
- UI state or webhook receipt alone never marks an order paid.
- Seller refund approval alone never marks an order refunded.
- Manual shipment records remain `seller_entered_unverified` until a trusted carrier adapter provides evidence.
- Tax and logistics providers remain unavailable when not configured.
- Historical staging for commit `38e2f68` is not evidence for the current source revision.

## Exact next local slice

Implement a persisted owner-created Seller team invitation lifecycle with target-account binding, role binding, expiry, one-time acceptance, revoke/cancel, immutable audit and Snapshot migration tests. The browser must not hold invitation signing secrets, and acceptance must remain dependent on the canonical Wallet identity tuple rather than creating a parallel login protocol.
