# YNX Monitor Dependency Acceptance

Status: Open  
Owner: `13-monitor`  
Last updated: 2026-07-28

No dependency is accepted merely because an endpoint returns HTTP 200. Acceptance requires a versioned contract, owner identity, source commit, authentication boundary, freshness semantics, failure semantics, negative vectors, and shared-Testnet evidence.

| Owner | Dependency | Current state | Acceptance gate |
|---|---|---|---|
| `02-wallet-auth` | Product-scoped Wallet challenge and role assignment | Adapter, local replay tests, and Monitor-owned exact Origin/session-bound CSRF mutation gates pass | Accepted product registration, expiry/revoke vectors, wrong-product/device/scope rejection, accepted private operator origin, shared-Testnet proof |
| `01-chain-core` | Node, validator, peer, finality, state-sync, snapshot, lane, conflict telemetry | Basic node/validator/peer probes exist | Frozen schemas, source/version/asOf fields, stale/failure semantics, negative and restart vectors |
| `07-exchange` | Order, fill, sequence, funding, liquidation, insurance, ADL telemetry | Not integrated | Frozen read-only API and sequence-gap/stale vectors |
| `27-dex` | Pool, reserve, route, solver, MEV, LP telemetry | Not integrated | Frozen read-only API and reorg/stale/reconciliation vectors |
| `19-oracle-market-data` | Price quality, confidence, stale, divergence, provider state | Not integrated | Frozen owner schema; Monitor must not recompute price truth |
| `08-quant-lab` | Engine, worker, strategy, mandate, risk, kill switch, cost, PnL, fee, reconciliation | Not integrated | Frozen read-only schema and risk-breach/revoke/restart vectors |
| `17-tokenomics` | Solvency, reserve, staking, safety, treasury, revenue, burn | Not integrated | Frozen source-labelled facts and no unsupported financial derivation |
| `21-bridge` | Exposure, route, finality, failure, refund state | Not integrated | Frozen lifecycle and finality semantics |
| `16-resource-market` | Provider health, bond, capacity, usage, settlement | Not integrated | Frozen metering and settlement state machine |
| `26-data-fabric` | Canonical events and billing telemetry | Not integrated | Frozen event IDs, ordering, idempotency, retention, and replay semantics |
| `28-website` | `/monitor` entry and redacted public status | Not integrated | Public/private redaction vector and canonical metadata acceptance |
| `29-integration` | Contract freeze and shared Testnet | Pending | Unique version freeze and cross-product vector execution |
| `30-security-sre-release` | Release, artifact, backup, restore, rollback, security evidence | Typed local evidence consumer and independent-verification vectors pass; no real recovery artifact accepted | Frozen signed/hashed release manifest, immutable artifact identity, retention policy, isolated restore/rollback drill, and central execution/recovery evidence with truthful status |

## Rejection rules

Monitor rejects or marks unavailable any dependency response that lacks required identity or freshness fields, violates its frozen version, widens authority, reports stale data as current, exposes secrets, or conflicts with the authoritative owner. A rejected dependency must not be replaced by static success, a mock production response, or a second Monitor-owned version of the central protocol.
