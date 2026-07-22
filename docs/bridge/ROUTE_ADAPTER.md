# Bridge Route Adapter

Status date: 2026-07-22.

`GET /bridge/routes` is the public, credential-free route registry. It reports configured candidates, not provider quotes. Every current entry is `unavailable`, non-executable, and external-submission-disabled. Unknown contracts, token metadata, fees, slippage, timing, destination finality, explorer links, and refund SLA are JSON `null`; `null` never means zero.

The exact route classifications are:

1. `official-stablecoin-transfer-candidate`
2. `proof-based-canonical-bridge-candidate`
3. `external-bridge-adapter`
4. `route-aggregator`
5. `manual-operator-testnet-transfer`

Each catalog entry discloses Provider, classification, source and Destination chains/assets, Contracts and verification, Tokens and decimals, Fees and hidden-spread state, Slippage, Time, Risk, Finality, proof-verification coverage, Refund mode/SLA, route limits, availability, execution state, signing boundary, and credential boundary. An unavailable entry has no quote ID, expiry, fee estimate, or executable route.

The canonical Wallet must review and sign a future route intent. Browsers, Pay, DEX, Exchange, and other consumers receive no Bridge API key, provider secret, signer, seed, or withdrawal authority. Protected mutations remain behind the accepted App Gateway integration boundary.

Circle CCTP is classified only as an official stablecoin transfer candidate. The inspected official testnet contract-address reference did not list YNX, so contracts, credentials, funding, remote tests, and public deployment remain absent. License, terms, jurisdiction, authentication, rate limits, retention, data rights, version, health, fallback, and outage behavior must be reviewed for an actual supported route; the machine provider record keeps unresolved fields explicit.

A route may become executable only after official provider/network support, verified source and destination contracts, token metadata, legal and operational review, credential provisioning outside consumers, funded Testnet receipts, destination evidence, refund/recovery validation, security approval, and central Wallet/Gateway acceptance.
