# YNX Wallet/Auth Integration Handoff

## Authority and source

- Owner: `02-wallet-auth`
- Source commit: `853b2e0bf923e3d3535685c38b3e2396c2ea56df`
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
| StrategyMandate | 2 |
| StrategyAction | 1 |
| StrategyMandate store | 1 |

Registry v2 contains 26 sorted, unique registrations. `quant` is present but remains `pending-review` and disabled until the central owner explicitly approves it. The v1-to-v2 migration only accepts the exact prior 25-product set and deterministically adds the disabled Quant registration.

## Gateway merge surface

The App Gateway owner should merge the adapter rather than reimplementing Wallet semantics. Every operation requires an unconsumed P-256 Product Session HTTP proof bound to method, canonical path and body digest.

| Operation | Required scope | Additional binding |
| --- | --- | --- |
| Complete Product Session | none | Wallet approval plus product-device challenge |
| Introspect | requested subset | Product, bundle, device and active revocation state |
| Activate mandate | `quant:mandate:create` | Account, product and exact session binding |
| Authorize strategy action | `quant:mandate:execute` | Mandate digest, nonce domain, action nonce, typed target and all limits |
| Inventory | `quant:account` | Account and product |
| Revoke / kill / emergency exit | `quant:mandate:revoke` | Existing mandate ownership and exact Product Session |

The Gateway must persist both the Product Session replay store and StrategyMandate store atomically. A process restart must not restore consumed proofs, action nonces, revoked mandates or killed mandates to an executable state.

## Asset authority boundary

An exchange mandate is valid only for an explicit subaccount identifier, with no withdrawals, no owner change, an independent nonce domain and immediate revocation. A DEX mandate must enumerate typed Vault, Pool and Router targets and the exact method union. Arbitrary transfer, `transferFrom`, approvals, unlimited approval, ownership transfer, admin change and upgrade selectors are prohibited.

Quant, AI, App Gateway and other products receive no private key, seed, arbitrary withdrawal authority or owner-change authority. They may submit a bounded action for Wallet/Gateway authorization; they may not sign on the user's behalf.

## Verification already completed

- Wallet/Auth package: 75/75 tests passed.
- Product Session proof: replay, method/path/body substitution and device mismatch rejected.
- StrategyMandate: activation, action authorization, restart persistence, replay rejection, revoke, kill and emergency exit tested.
- Registry v1-to-v2 and Gateway snapshot v1-to-v2 migration tested.
- SDK package dry run passed.

These are local implementation and test facts. No direct YNX Testnet mandate transaction, public Gateway endpoint, central event acceptance, Explorer proof or Monitor proof has been recorded yet.

## Owner-specific next actions

1. **App Gateway**: merge the adapter, supply durable transactional storage and expose the exact operations without bearer-token compatibility.
2. **01 Chain Core**: provide the accepted EntryPoint, EVM/RPC identity, receipt schema and Testnet deployment facts.
3. **26 Data Fabric**: accept the canonical Wallet event names and billing-ledger mappings without becoming the Wallet authority.
4. **19 Oracle**: supply source-labelled capital-product and stablecoin reference facts.
5. **12 Explorer / 13 Monitor**: index sessions, approvals, mandates, actions, UserOperations, sponsor decisions and revocations from authoritative events.
6. **15 Trust Center**: bind mandate disputes and corrections to immutable audit IDs without gaining asset authority.
7. **29 Integration**: freeze the merge order and run the shared Testnet vectors.

Until those actions produce direct evidence, `integratedCentral`, `deployedStaging` and `deployedPublic` remain false.
