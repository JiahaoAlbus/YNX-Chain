# YNX Seller Console Decisions

## D-001 — Canonical seller roles

The canonical role set is `owner`, `admin`, `catalog`, `inventory`, `fulfillment`, `finance`, `support`, and `viewer`. The former `manager` role is not accepted by new APIs.

Reason: the product goal requires separate Catalog, Inventory, Fulfillment, Finance, Support and Viewer duties. A broad manager role cannot prove least privilege.

## D-002 — Backward migration without dual protocol

Snapshot v2 `manager` values migrate once to canonical `admin`. Current state persists as Snapshot v5, which additionally initializes Seller role-revocation records and append-only Seller integration events. Public APIs and UI expose only the canonical role set.

Reason: preserve historical user state without maintaining two long-lived role protocols, while keeping revocation and event evidence versioned.

## D-003 — Fail closed on unknown authority

Unknown roles and unknown permissions deny access, including read paths. Owner/Admin receive all known Seller permissions only; an unknown permission is not implicitly granted.

## D-004 — Truthful release status

Historical staging and artifacts for commit `38e2f68` remain historical records. They do not set current-source `deployedStaging`, `deployedPublic`, or `downloadHosted` to true.

## D-005 — Central authority ownership

Seller Console consumes Wallet/Auth, Pay, Trust, Data Fabric, Monitor, Website, Integration and Security contracts. It does not reimplement or claim authority over those central systems.

## D-006 — Local-first fail-closed role revocation

An owner revocation removes local store authority before attempting central Wallet invalidation. The revoked account cannot be regranted until the exact store-scoped Wallet receipt is confirmed. Unavailable, rejected, malformed, cross-account, cross-product, cross-bundle, cross-store, or future-dated receipts remain non-confirmed.

Reason: a provider outage must not preserve Seller access, and a forged or mismatched receipt must not reopen the authorization boundary.

## D-007 — Transactional local Outbox without central ownership claims

Role revocation and authorization-invalidation updates append versioned Seller integration events in the same persistence transaction as the role, revocation, and audit state. Persistence failure rolls back all of them. These records are candidates for Owner 26 Data Fabric ingestion, not proof of canonical ingestion.
