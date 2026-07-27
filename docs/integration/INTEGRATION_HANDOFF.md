# YNX Seller Console Integration Handoff

- Product: `10 | YNX Seller Console`
- Branch: `codex/final-seller-console`
- Source commit: `62d5a1833b9a901a339dc267ef78779ba793a095`
- Stage: `FREEZE`
- Goal status: `Active`

## Frozen local contract

Seller Console now uses the canonical role set `owner`, `admin`, `catalog`, `inventory`, `fulfillment`, `finance`, `support`, and `viewer`. New role assignments reject the legacy `manager` value. Snapshot v2 data migrates `manager` to `admin` while writing Snapshot v3.

All role and permission lookups fail closed. Catalog, inventory, fulfillment, finance, support, and read-only responsibilities are separated. Only the owner can assign roles or activate and change the store policy boundary.

The machine-readable contract is `release/integration/seller-console-contract.json`.

## Verified local evidence

- `go test ./internal/commerce`
- `npm test` in `apps/seller-console`
- `npm run build` in `apps/seller-console`
- `npm run smoke` in `apps/seller-console`: `/health` and `/api/capabilities` returned success from the existing local service on `127.0.0.1:8095`.

The HTTP smoke does not prove that the current source revision is deployed publicly. Current-source `deployedStaging`, `deployedPublic`, and `downloadHosted` remain false.

## Dependency handoff

| Owner | Required acceptance | Current state |
|---|---|---|
| 02 Wallet/Auth | Deploy `ynx-seller-v1` registration, exact ordered scopes, session introspection, expiry and revoke | Pending |
| 04 Pay | Authoritative settlement and refund evidence contract | Pending |
| 15 Trust Center | Dispute and appeal evidence contract | Pending |
| 26 Data Fabric | Canonical commerce events and billing ledger | Pending |
| 13 Monitor | Health, SLO, alert and incident ingestion | Pending |
| 28 Website | Canonical `/seller-console` metadata and release route | Pending |
| 29 Integration | Shared Testnet contract freeze and end-to-end vectors | Pending |
| 30 Security/SRE | Artifact, backup, security and release gate | Pending |

## Truth boundaries

- UI state or webhook receipt alone never marks an order paid.
- Seller refund approval alone never marks an order refunded.
- Manual shipment records remain `seller_entered_unverified` until a trusted carrier adapter provides evidence.
- Tax and logistics providers remain unavailable when not configured.
- Historical staging for commit `38e2f68` is not evidence for the current source revision.

## Next local slice

Implement owner-only role revocation with an immutable audit event and a fail-closed Wallet session-invalidation adapter. The adapter must not fabricate successful central revocation when Wallet/Auth is unavailable.
