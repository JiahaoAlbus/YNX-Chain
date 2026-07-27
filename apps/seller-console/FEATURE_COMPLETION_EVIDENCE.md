# YNX Seller Console Feature Completion Evidence

Version: `0.3.0-testnet-preview`  
Source commit: `62d5a1833b9a901a339dc267ef78779ba793a095`  
Stage: `FREEZE`  
Goal: `Active`

## Canonical least-privilege RBAC

Implemented and locally tested:

- Roles: Owner, Admin, Catalog, Inventory, Fulfillment, Finance, Support, Viewer.
- Only Owner can assign roles.
- Owner and legacy `manager` cannot be assigned through the new role API.
- Snapshot v2 `manager` records migrate to Snapshot v3 `admin`.
- Unknown roles and permissions fail closed.
- Catalog may edit/publish catalog but may not set inventory.
- Inventory may set inventory but may not edit catalog.
- Fulfillment may ship paid orders but may not approve refunds.
- Support may resolve returns but may not approve refunds.
- Finance may read settlement evidence and approve refunds but may not edit catalog or fulfill orders.
- Viewer is read-only.

Direct source:

- `internal/commerce/roles.go`
- `internal/commerce/accounts.go`
- `internal/commerce/service.go`
- `internal/commerce/store.go`
- `internal/commerce/roles_test.go`
- `apps/seller-console/index.html`

Verified commands:

- `go test ./internal/commerce`
- `npm test` in `apps/seller-console`
- `npm run build` in `apps/seller-console`
- `npm run smoke` in `apps/seller-console`

## Current truth boundaries

- Local tests and build do not establish central integration or public deployment.
- The HTTP smoke ran against an existing local service on `127.0.0.1:8095`; it proves only local endpoint availability.
- Historical staging and artifact records belong to commit `38e2f68`, not this source revision.
- Current-source staging, public deployment and hosted artifact statuses remain false.
- Wallet registry deployment, authoritative Pay/Trust integration, provider integrations, shared Testnet proof, SLO/capacity, complete accessibility, security, supply-chain and restore evidence remain incomplete.

## Evidence binding

This document, `product-release.json`, the full-goal coverage matrix and integration contract are bound to source checkpoint `62d5a1833b9a901a339dc267ef78779ba793a095`; this evidence-binding update is committed separately so the referenced source checkpoint remains immutable.
