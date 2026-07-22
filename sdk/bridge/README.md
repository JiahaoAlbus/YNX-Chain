# YNX Bridge SDK

`@ynx-chain/bridge-sdk` is a dependency-free, read-only JavaScript client for the public Bridge health, transparency, route-catalog, token-allowlist, and product-status surfaces. It validates source, version, timestamps, route/asset shape, null contract and quote evidence, and the fail-closed relationship between local availability, external Bridge readiness, provider connection, public deployment, support, and execution.

The SDK never accepts or sends Bridge API keys, Wallet sessions, provider credentials, relayer keys, private keys, or transaction signatures. It cannot create, attest, finalize, retry, refund, dispute, mint, release, or submit a transfer. Consumer products must use the canonical Wallet/App Gateway approval boundary for any future mutation integration.

`bridgeTransferAvailability` is the shared lifecycle guard. Only `destination_confirmed` yields `assetAvailable=true`; quote, source acceptance/finality, proof, provider callback, destination mint/release, failure, recovery, and dispute do not make an asset spendable.

This package is locally tested and unpublished. No public Bridge endpoint or live external route is implied.
