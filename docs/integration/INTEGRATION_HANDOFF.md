# YNX Wallet/Auth Integration Handoff

## Authority and source

- Owner: `02-wallet-auth`
- Source commit: `61df5559c647d880cc1d435bece9d89ff66a07e1`
- Current gate: `INTEGRATE`
- Machine-readable contract: `release/integration/wallet-auth-contract.json`
- Shared StrategyMandate vector: `packages/wallet-auth/testdata/strategy-mandate-v2.json`

This handoff freezes the Wallet-owned identity, device, approval, Product Session, revocation and StrategyMandate boundaries. It does not claim that App Gateway, Chain Core, Data Fabric, Explorer, Monitor, Oracle, Trust Center or the shared Testnet have merged or deployed this candidate.

## Frozen protocol

The accepted local protocol binds the network and chain, requesting product, product client, bundle, callback, P-256 product-device public key, account, ordered scopes, purpose, nonce, issuance and expiry, request digest, approval digest and session binding. Unknown fields, scope widening or reordering, callback replacement, product/device/bundle substitution, future timestamps, replay, storage tamper, expiry and revoked state fail closed.

Current versions:

| Component | Version |
| --- | ---: |
| Authorization Request / Wallet Approval / Device Challenge / Product Session | 1 |
| Product Session HTTP proof | 1 |
| Central Registry document | 2 |
| Product registration | 3 |
| Gateway adapter snapshot | 2 |
| Gateway HTTP kernel | 1 |
| Gateway Node state | 1 |
| Gateway observability | 1 |
| StrategyMandate | 2 |
| StrategyAction | 1 |
| StrategyMandate store | 1 |

Registry v2 contains 26 sorted, unique registrations. `quant` is present but remains `pending-review` and disabled until the central owner explicitly approves it. The v1-to-v2 migration only accepts the exact prior 25-product set and deterministically adds the disabled Quant registration.

## Gateway merge surface

The App Gateway owner should mount `CanonicalWalletGatewayHttpKernel` rather than reimplement Wallet semantics. Session completion carries no Product Session proof because the session does not exist yet. Every later operation requires an unconsumed P-256 proof supplied separately from the canonical business body and bound to method, canonical path and the raw-body SHA-256 digest.

| Operation | Path | Required scope | Additional binding |
| --- | --- | --- | --- |
| Complete Product Session | `/v1/wallet/sessions/complete` | none | Wallet approval plus product-device challenge; proof header is null |
| Introspect | `/v1/wallet/sessions/introspect` | requested subset | Product, bundle, device, exact body and active revocation state |
| Revoke session | `/v1/wallet/sessions/revoke` | none | Exact session, device and path-bound proof |
| Revoke own approval | `/v1/wallet/approvals/revoke` | none | Proof must come from a session created by the approval being revoked |
| Revoke own product device | `/v1/wallet/devices/revoke` | none | Proof must come from the product device being revoked |
| All-device logout | `/v1/wallet/accounts/logout-all` | `wallet:sessions` | Exact canonical Wallet client and bundle only; writes account-wide cutoff |
| Activate mandate | `/v1/wallet/mandates/activate` | `quant:mandate:create` | Account, product and exact session binding |
| Authorize strategy action | `/v1/wallet/mandates/authorize-action` | `quant:mandate:execute` | Mandate digest, nonce domain, action nonce, typed target and all limits |
| Inventory | `/v1/wallet/mandates` | `quant:account` | Account and product |
| Revoke / kill / emergency exit | `/v1/wallet/mandates/*` | `quant:mandate:revoke` | Existing mandate ownership and exact Product Session |

The host must persist Gateway snapshot v2 atomically with the returned state digest. Product Session replay state, Product Sessions, revocations, StrategyMandates, action nonces, terminal controls and audit data share one transaction boundary. A failed request restores the pre-request snapshot and must not consume a proof. A restart must not restore consumed proofs, action nonces, revoked mandates or killed mandates to an executable state.

The source-bound Node host also provides unauthenticated loopback `GET /health`, `/ready`, `/version` and `/metrics`. Every response carries generated request and trace IDs; failures carry an error ID. Metrics use a fixed route label set and bounded public error codes, while canonical JSON events exclude bodies, Product Session proofs, authorization headers, custody material, signatures, provider secrets and state paths. Event-sink failure is isolated and counted. Any process marked `remoteDeployed=true` must present a full lowercase source commit, release identifier and canonical UTC build time; runtime readiness remains separate from public-deployment readiness.

## Asset authority boundary

An exchange mandate is valid only for an explicit subaccount identifier, with no withdrawals, no owner change, an independent nonce domain and immediate revocation. A DEX mandate must enumerate typed Vault, Pool and Router targets and the exact method union. Arbitrary transfer, `transferFrom`, approvals, unlimited approval, ownership transfer, admin change and upgrade selectors are prohibited.

Quant, AI, App Gateway and other products receive no private key, seed, arbitrary withdrawal authority or owner-change authority. They may submit a bounded action for Wallet/Gateway authorization; they may not sign on the user's behalf.

## Verification already completed

- Wallet/Auth package: 94/94 tests passed.
- Gateway HTTP kernel: twelve exact routes, canonical-body enforcement, separate proof transport, immutable registry, exact state digest, restart, replay, request-level rollback, self-scoped approval/device revoke and Wallet-only all-device logout tested.
- Gateway Node host: 8/8 tests plus a real loopback CLI smoke cover health/readiness/version/metrics, generated request/trace/error IDs, exact remote build identity, bounded metric labels, redacted events, Node-only package export and event-sink failure isolation.
- Product Session proof: replay, method/path/body substitution and device mismatch rejected.
- StrategyMandate: activation, action authorization, restart persistence, failed-operation proof atomicity, replay rejection, revoke, kill and emergency exit tested.
- Registry v1-to-v2 and Gateway snapshot v1-to-v2 migration tested.
- Browser SDK: 7/7 passed from its independent lockfile; JS SDK: 5/5 passed.
- SDK package dry run and `umask 0022; go test ./...` passed; the MCP default `umask 0077` was recorded as a fixture precondition because it automatically tightened two non-Wallet unsafe-permission test files.

These are local implementation and test facts. No direct YNX Testnet mandate transaction, public Gateway endpoint, central event acceptance, Explorer proof or Monitor proof has been recorded yet.

## Owner-specific next actions

1. **App Gateway**: merge the adapter and Node-host boundary, supply durable transactional storage, expose the exact operations without bearer-token compatibility, and bind readiness/version to an exact deployed build identity.
2. **01 Chain Core**: provide the accepted EntryPoint, EVM/RPC identity, receipt schema and Testnet deployment facts.
3. **26 Data Fabric**: accept the canonical Wallet event names and billing-ledger mappings without becoming the Wallet authority.
4. **19 Oracle**: supply source-labelled capital-product and stablecoin reference facts.
5. **12 Explorer / 13 Monitor**: index authoritative sessions, approvals, mandates, actions, UserOperations, sponsor decisions and revocations; accept the bounded Gateway metrics/events and prove dashboards, SLO alerts and request/error/audit correlation.
6. **15 Trust Center**: bind mandate disputes and corrections to immutable audit IDs without gaining asset authority.
7. **29 Integration**: freeze the merge order and run the shared Testnet vectors.

Until those actions produce direct evidence, `integratedCentral`, `deployedStaging` and `deployedPublic` remain false.
