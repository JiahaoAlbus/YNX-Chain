# Current plan

- Product: YNX Resource Market (`16-resource-market`)
- Stage: `INTEGRATE`
- Long-term goal: `ACTIVE`
- Protected runtime source: `a940d2efa824bd9f43522ed792c9a563b55e1e11`
- Branch: `codex/final-resource-market`

## Protected checkpoint

The runtime source above is pushed and remote-equal. It enforces exact Offer-scoped capacity reservations, rejects fixed-price and auction provider self-dealing, migrates the reservation ledger to schema 6, and applies checked non-negative signed-64-bit arithmetic across quote, auction, metering, settlement and dispute paths. Overflow fails before authoritative mutation. Core, Product/API, Race, Vet, JSON-contract and cold-start smoke gates passed.

## Exact next autonomous action

Make provider-failure retries explicitly bounded and auditable. Persist one-to-one failed-order→retry-order lineage, reject duplicate or chained retry abuse, migrate existing state without inventing retry events, expose stable failure semantics and cross-product negative vectors, then run targeted tests, Race, Vet and the product smoke gate before Commit/Push.

## External dependencies that remain

Central Wallet/Gateway acceptance, authoritative Chain/Data Fabric settlement, Explorer/Monitor/Trust integration, two independently operated public providers, Testnet funding, public deployment/DNS, production signing and legal review remain unproven. They do not block the local retry-integrity slice above.
