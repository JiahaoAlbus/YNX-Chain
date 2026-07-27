# Current plan

- Product: YNX Resource Market (`16-resource-market`)
- Stage: `INTEGRATE`
- Long-term goal: `ACTIVE`
- Protected runtime source: `03a9898bff2ba7c7ec014f5531fa168b78192359`
- Branch: `codex/final-resource-market`

## Protected checkpoint

The runtime source above is pushed and remote-equal. It enforces exact Offer-scoped capacity reservations, rejects fixed-price and auction provider self-dealing, migrates the reservation ledger to schema 6, and fails closed on semantic ledger mismatch. Core, Product/API, Race, Vet, JSON-contract and cold-start smoke gates passed.

## Exact next autonomous action

Audit every monetary multiplication and addition in quote, auction, metering, refund and settlement paths. Replace unchecked `int64` arithmetic with fail-closed checked arithmetic, add stable overflow/error semantics and cross-product negative vectors, then run targeted tests, Race, Vet and the product smoke gate before Commit/Push.

## External dependencies that remain

Central Wallet/Gateway acceptance, authoritative Chain/Data Fabric settlement, Explorer/Monitor/Trust integration, two independently operated public providers, Testnet funding, public deployment/DNS, production signing and legal review remain unproven. They do not block the local economic-integrity slice above.
