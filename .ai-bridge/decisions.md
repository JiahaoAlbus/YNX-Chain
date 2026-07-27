# YNX Seller Console Decisions

## D-001 — Canonical seller roles

The canonical role set is `owner`, `admin`, `catalog`, `inventory`, `fulfillment`, `finance`, `support`, and `viewer`. The former `manager` role is not accepted by new APIs.

Reason: the product goal requires separate Catalog, Inventory, Fulfillment, Finance, Support and Viewer duties. A broad manager role cannot prove least privilege.

## D-002 — Backward migration without dual protocol

Snapshot v2 `manager` values migrate once to Snapshot v3 `admin`. Runtime lookup may canonicalize a legacy stored value during migration, but public APIs and UI expose only the canonical role set.

Reason: preserve historical user state without maintaining two long-lived role protocols.

## D-003 — Fail closed on unknown authority

Unknown roles and unknown permissions deny access, including read paths. Owner/Admin receive all known Seller permissions only; an unknown permission is not implicitly granted.

## D-004 — Truthful release status

Historical staging and artifacts for commit `38e2f68` remain historical records. They do not set current-source `deployedStaging`, `deployedPublic`, or `downloadHosted` to true.

## D-005 — Central authority ownership

Seller Console consumes Wallet/Auth, Pay, Trust, Data Fabric, Monitor, Website, Integration and Security contracts. It does not reimplement or claim authority over those central systems.
