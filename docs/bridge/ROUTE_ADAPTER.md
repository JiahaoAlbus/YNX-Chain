# Bridge Route Adapter

Status date: 2026-07-26.

`GET /bridge/routes` is the public, credential-free route registry. It reports configured candidates, not provider quotes. Every current entry is `unavailable`, non-executable, and external-submission-disabled. Unknown contracts, token metadata, fees, slippage, timing, destination finality, explorer links, and refund SLA are JSON `null`; `null` never means zero.

The exact route classifications are:

1. `official-stablecoin-transfer-candidate`
2. `proof-based-canonical-bridge-candidate`
3. `external-bridge-adapter`
4. `route-aggregator`
5. `manual-operator-testnet-transfer`

Each catalog entry discloses Provider, classification, source and Destination chains/assets, Contracts and verification, Tokens and decimals, Fees and hidden-spread state, Slippage, Time, Risk, Finality, proof-verification coverage, Refund mode/SLA, route limits, availability, execution state, signing boundary, and credential boundary. An unavailable entry has no quote ID, expiry, fee estimate, or executable route.

The canonical Wallet must review and sign a future route intent. Browsers, Pay, DEX, Exchange, and other consumers receive no Bridge API key, provider secret, signer, seed, or withdrawal authority. Protected mutations remain behind the accepted App Gateway integration boundary.

The Runtime contains a Circle-specific CCTP V2 testnet adapter for the official permissionless Iris Sandbox fee endpoint. A provider route configuration must bind an owned route policy, the exact official HTTPS host, an inspected built-in CCTP testnet chain/domain pair, native USDC metadata, token and Bridge contracts, explorer evidence, a finality tier, reviewed timing bounds, route-support verification, contract verification, agreement approval, and operational-review approval. Positive approval flags require separate HTTPS evidence plus explicit license/terms, jurisdiction, retention, data-rights, fallback, and outage policies. Quote responses are HMAC-sealed with a dedicated server-side key; provider response timeouts, redirects, non-200 status, oversized bodies, schema changes, duplicate tiers, and missing finality tiers fail closed. The adapter never submits a source transaction.

Circle CCTP remains only an official stablecoin transfer candidate for YNX. The official CCTP V2 Sandbox fee API was directly reached for the supported Ethereum Sepolia (domain 0) to Base Sepolia (domain 6) route, proving Provider API connectivity but not YNX support. The inspected official supported-chain and contract references do not list YNX, so the YNX route, YNX contracts, funding, remote YNX transfer tests, and public deployment remain absent.

A route may become executable only after official provider/network support, verified source and destination contracts, token metadata, legal and operational review, credential provisioning outside consumers, funded Testnet receipts, destination evidence, refund/recovery validation, security approval, and central Wallet/Gateway acceptance.
