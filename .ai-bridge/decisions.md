# YNX Seller Console Decisions

## D-001 — Canonical seller roles

The canonical role set is `owner`, `admin`, `catalog`, `inventory`, `fulfillment`, `finance`, `support`, and `viewer`. The former `manager` role is not accepted by new APIs.

Reason: the product goal requires separate Catalog, Inventory, Fulfillment, Finance, Support and Viewer duties. A broad manager role cannot prove least privilege.

## D-002 — Backward migration without dual protocol

Snapshot v2 `manager` values migrate once to canonical `admin`. Current state persists as Snapshot v6, which additionally initializes Seller role-revocation records, Wallet-account-bound invitations, and append-only Seller integration events. Public APIs and UI expose only the canonical role set.

Reason: preserve historical user state without maintaining two long-lived role protocols, while keeping invitation, revocation and event evidence versioned.

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

Role updates, team invitation transitions, role revocation, and authorization-invalidation updates append versioned Seller integration events in the same persistence transaction as the role, invitation, revocation, and audit state. Persistence failure rolls back all of them. These records are candidates for Owner 26 Data Fabric ingestion, not proof of canonical ingestion.

## D-008 — First membership requires canonical Wallet acceptance

An invitation is bound to a store, target native Wallet account, assignable role and expiry. The invitation ID is not an authentication credential. Only the exact authenticated target account may accept once; wrong-account access returns not found. The direct role-update API only changes an existing member and cannot create first-time authority.

Reason: prevent owners, leaked identifiers, browser state or replayed requests from silently granting authority without target-account consent.

## D-009 — Rollback is export, never in-place downgrade

Snapshot v6 rollback creates a new v3, v4 or v5 file, preserves the active state, retains the integrity envelope when configured, and refuses every target that cannot represent the current Seller authority or Outbox state.

Reason: an operator rollback must not silently erase invitations, revocations, Audit or Seller integration evidence merely because an older binary cannot decode it.

## D-010 — Retention is narrow, preview-first and evidence-preserving

Store Owner portability exports are scoped to one store and audited. Automated retention may remove only terminal AI drafts and expired rate-limit samples after a minimum 30-day boundary, requires an integrity key and explicit confirmation, and cannot remove financial or authority evidence.

Reason: service exit and storage hygiene are required, but they must not become a hidden path for deleting orders, settlement/refund evidence, permissions, Outbox, Audit or idempotency records.
