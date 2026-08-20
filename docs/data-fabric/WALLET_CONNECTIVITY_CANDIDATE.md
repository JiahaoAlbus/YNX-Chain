# Wallet Connectivity Event Contract — Candidate

Status: `CANDIDATE`; activation: prohibited until Integration accepts a central
`connectionEvents` contract. This document and its schema are not a Registry
activation and do not change Wallet, Gateway, Product Session, SDK, financial
application, Explorer/Monitor, or central control-plane behavior.

The Data Fabric path is an asynchronous observer only. It is outside:

`DApp → Connect Wallet → Wallet Approval → Standard Wallet Connection`.

An unavailable Data Fabric, broker, analytics service, ledger, or monitor must
not block a standard connection or be translated to `Wallet Offline`. Product
Session remains an optional private-service enhancement.

Candidate artifacts:

- `schemas/data-fabric/wallet-connectivity-events-v1.candidate.schema.json`
- `schemas/data-fabric/wallet-connectivity-events-v1.candidate.vectors.json`

The candidate requires a tenant partition, per-product keyed pseudonymous
connection ID, delivery sequence, effective timestamp, and SHA-256 payload
integrity reference. It has no account address, public user ID, device
identifier, secret, bearer token, WalletConnect symmetric key, full signature,
private SIWE content, PAN, CVV, or private message field. Only aggregate
counters may leave Data Fabric diagnostics.

`faucet.requested` is not a payment or finality claim. `faucet.completed` is
valid only with a Faucet acceptance identifier, transaction hash, authoritative
receipt identifier, and `finalized` finality in the candidate record. A deep
link callback alone cannot create it.

Integration review must decide the accepted owner, version, consumer list,
migration and rollback before the schema can be added to
`schema-registry-v2.json` or be consumed by a runtime.
