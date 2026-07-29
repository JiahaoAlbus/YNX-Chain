# YNX Seller Console Integration Handoff

- Product: `10 | YNX Seller Console`
- Branch: `codex/final-seller-console`
- Source commit: `a90d1ee59eec38c15ce42b39420f2625ed758dd0`
- Stage: `FREEZE`
- Goal status: `Active`

## Frozen local authority contract

Seller Console uses canonical Wallet product sessions and the role set `owner`, `admin`, `catalog`, `inventory`, `fulfillment`, `finance`, `support`, and `viewer`. New APIs reject the legacy `manager` role.

First-time Seller membership requires an owner-created invitation bound to the exact target native Wallet account, store, assignable role and expiry. The invitation ID is not an authentication credential. Only the exact authenticated target account may accept once; wrong-account access returns not found, replay fails, cancellation is permanent, and expired invitations cannot grant authority. The direct role-update API only changes an existing member.

Only an owner may revoke a non-owner role. Local Seller authority is removed before the central Wallet call. A revoked account cannot be regranted until a fully bound store-scoped Wallet authorization-revocation receipt is confirmed. Missing, rejected, malformed, future-dated, cross-account, cross-product, cross-bundle, or cross-store receipts fail closed.

Snapshot v2 state migrates to Snapshot v6. Snapshot v6 initializes revocations, invitations and append-only Seller integration events without retaining a dual `manager` protocol. Runtime startup rejects future snapshot versions instead of normalizing them downward.

## Migration, rollback and data lifecycle

The operator-only rollback path exports a new Snapshot v3, v4 or v5 file and never overwrites the active state or an existing destination. When an integrity key is configured, the export remains HMAC protected. The export refuses every representation that would silently discard Seller invitations, unsupported revocations, unsupported Seller events or v6-only event fields.

`POST /api/seller/stores/{id}/exports` is limited to the exact store owner. The export contains the store profile, catalog and inventory, orders and attached settlement/refund evidence, Seller roles, invitations, revocations, local Outbox and store-scoped Audit. It excludes unrelated stores, transient AI jobs, rate-limit windows, browser/provider credentials and unrelated buyer state. Export access is itself audited.

Transient retention is preview-only unless the operator supplies explicit confirmation. It requires an integrity key, accepts only a cutoff at least 30 days old, and removes only terminal AI drafts and expired rate-limit samples. Orders, financial evidence, roles, invitations, revocations, Outbox, Audit, idempotency records, buyer profiles and carts are protected from this operation.

The detailed compatibility and operator procedure is `docs/operations/MIGRATION_COMPATIBILITY.md`.

## Persisted local Outbox

The same persistence transaction as the role, invitation, revocation and Audit state appends:

- `ynx.seller.role.updated.v1`
- `ynx.seller.role.revoked.v1`
- `ynx.seller.authorization.revocation.updated.v1`
- `ynx.seller.team.invitation.created.v1`
- `ynx.seller.team.invitation.accepted.v1`
- `ynx.seller.team.invitation.cancelled.v1`
- `ynx.seller.team.invitation.expired.v1`

Persistence failure rolls back the business state, Audit and Outbox together. These records are local integration candidates only. Owner 26 Data Fabric retains canonical event ownership and has not accepted or ingested them.

The machine-readable contract is `release/integration/seller-console-contract.json`. Cross-product and recovery vectors are in `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`.

## Verified local evidence

Bound to source commit `a90d1ee59eec38c15ce42b39420f2625ed758dd0`:

- `go test ./internal/commerce/...`: passed.
- `go test -race ./internal/commerce`: passed; macOS linker emitted a non-failing malformed `LC_DYSYMTAB` warning.
- `go vet ./internal/commerce/...`: passed.
- `npm test` in `apps/seller-console`: passed, 3 tests.
- `npm run build` in `apps/seller-console`: passed and produced the local unhosted `dist/` build.
- Rollback tests cover future-version refusal, version boundaries, representability, lossy refusal, destination safety, tamper and verified restore.
- Data-lifecycle tests cover owner-only/store-scoped export, unrelated-store isolation, deep-copy safety, canonical-session HTTP enforcement, minimum-retention bounds, preview/apply behavior, protected evidence and restart persistence.

A repository-wide `go test ./...` attempt from the preceding Seller checkpoint remained red only in non-Seller ownership areas: missing SampleEVMWriteCounter artifacts in BFT/Consensus and permissive-key permission assertions in Consensus TX, Faucet, and Trust. This worktree did not modify those products.

The existing local smoke script probes only `/health` and `/api/capabilities`; it does not prove that source commit `a90d1ee5` is the running service. Current-source `installedLocal`, `integratedCentral`, `deployedStaging`, `deployedPublic`, and `downloadHosted` remain false.

## Dependency handoff

| Owner | Required acceptance | Current state |
|---|---|---|
| 02 Wallet/Auth | Deploy `ynx-seller-v1`, exact ordered scopes, session introspection, and `POST /v1/product-authorizations/revocations` with a receipt bound to request/account/product/bundle/resource | Pending |
| 04 Pay | Authoritative settlement and refund evidence contract | Pending |
| 15 Trust Center | Dispute and appeal evidence contract | Pending |
| 26 Data Fabric | Freeze and ingest the versioned Seller role, invitation and revocation Outbox events idempotently | Pending |
| 13 Monitor | Health, SLO, alert and incident ingestion | Pending |
| 28 Website | Canonical `/seller-console` metadata and release route | Pending |
| 29 Integration | Shared Testnet contract freeze and end-to-end vectors | Pending |
| 30 Security/SRE | Artifact, backup, security and release gate | Pending |

## Truth boundaries

- A local Seller export is local authority evidence, not proof that Data Fabric accepted a canonical export or event.
- A local Outbox event is not evidence that Wallet/Auth revoked sessions or Data Fabric ingested a canonical event.
- UI state or webhook receipt alone never marks an order paid.
- Seller refund approval alone never marks an order refunded.
- Manual shipment records remain `seller_entered_unverified` until a trusted carrier adapter provides evidence.
- Tax and logistics providers remain unavailable when not configured.
- Historical staging for commit `38e2f68` is not evidence for the current source revision.

## Exact next local slice

Implement the bounded provider registry: Shipping, Tax, Address, Storage, Email, Webhook, Pay and Trust mode/health state; owner-only test, disable and credential-rotation metadata; rate-limit and outage behavior; no plaintext secret persistence; API, tests, documentation and integration vectors.
