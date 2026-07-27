# YNX Seller Console Integration Handoff

- Product: `10 | YNX Seller Console`
- Branch: `codex/final-seller-console`
- Source commit: `937cf10f387bd1d31d86652ab06d74bc6185f35c`
- Stage: `FREEZE`
- Goal status: `Active`

## Frozen local authority contract

Seller Console uses canonical Wallet product sessions and the role set `owner`, `admin`, `catalog`, `inventory`, `fulfillment`, `finance`, `support`, and `viewer`. New APIs reject the legacy `manager` role.

First-time Seller membership requires an owner-created invitation bound to the exact target native Wallet account, store, assignable role and expiry. The invitation ID is not an authentication credential. Only the exact authenticated target account may accept once; wrong-account access returns not found, replay fails, cancellation is permanent, and expired invitations cannot grant authority. The direct role-update API only changes an existing member.

Only an owner may revoke a non-owner role. Local Seller authority is removed before the central Wallet call. A revoked account cannot be regranted until a fully bound store-scoped Wallet authorization-revocation receipt is confirmed. Missing, rejected, malformed, future-dated, cross-account, cross-product, cross-bundle, or cross-store receipts fail closed.

Snapshot v2 state migrates to Snapshot v6. Snapshot v6 initializes revocations, invitations and append-only Seller integration events without retaining a dual `manager` protocol.

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

The machine-readable contract is `release/integration/seller-console-contract.json`.

## Verified local evidence

Bound to source commit `937cf10f387bd1d31d86652ab06d74bc6185f35c`:

- `go test ./internal/commerce`: passed.
- `go test -race ./internal/commerce`: passed; macOS linker emitted a non-failing malformed `LC_DYSYMTAB` warning.
- `go vet ./internal/commerce`: passed.
- `npm test` in `apps/seller-console`: passed.
- `npm run build` in `apps/seller-console`: passed and produced the local unhosted `dist/` build.
- Invitation tests cover owner-only creation, target visibility, wrong-account privacy, one-time acceptance, cancellation, expiry, duplicate active invitations, legacy/owner/self rejection, direct-grant bypass prevention, prior-revocation blocking, persistence rollback and restart.
- Role-revocation tests cover owner-only access, self/owner protection, idempotent repeat, conflicting repeat, unavailable provider, mismatched receipt, store-scoped effect, regrant blocking, event binding and restart persistence.

A full `go test ./...` preflight was attempted. Seller Commerce passed, but the repository-wide command remained red in non-Seller ownership areas: missing SampleEVMWriteCounter artifacts in BFT/Consensus and permissive-key permission assertions in Consensus TX, Faucet, and Trust. This thread did not modify those products.

The existing local smoke script probes only `/health` and `/api/capabilities`; it does not prove that source commit `937cf10` is the running service. Current-source `installedLocal`, `integratedCentral`, `deployedStaging`, `deployedPublic`, and `downloadHosted` remain false.

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

- Local invitation acceptance is authoritative only for Seller Console's local store-role state and only because the account is supplied by the canonical product session.
- A local Outbox event is not evidence that Wallet/Auth revoked sessions or Data Fabric ingested a canonical event.
- UI state or webhook receipt alone never marks an order paid.
- Seller refund approval alone never marks an order refunded.
- Manual shipment records remain `seller_entered_unverified` until a trusted carrier adapter provides evidence.
- Tax and logistics providers remain unavailable when not configured.
- Historical staging for commit `38e2f68` is not evidence for the current source revision.

## Exact next local slice

Implement Snapshot v6 downgrade safety: reject future snapshot versions, provide an explicit bounded rollback export that never silently drops unrepresentable invitation/revocation/Audit/Outbox state, and add migration/restore/operator evidence.
