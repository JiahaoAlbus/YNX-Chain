# YNX Bridge SDK

`@ynx-chain/bridge-sdk` is a dependency-free, read-only JavaScript client with TypeScript declarations for the public Bridge health, version, state-machine, transparency, route-catalog, asset-registry, and product-status surfaces. It validates source, runtime schema, state-machine version, timestamps, route and asset shape, dependency status, and fail-closed execution boundaries.

The SDK never accepts or sends Bridge API keys, Wallet sessions, provider credentials, relayer keys, private keys, or transaction signatures. It cannot create, attest, verify, finalize, retry, refund, dispute, mint, release, or submit a transfer. Consumer products must use the canonical Wallet/App Gateway approval boundary for any future mutation integration.

`bridgeTransferAvailability` is the shared lifecycle guard. `destination_mint_release_confirmed` remains unavailable. A consumer may treat the asset as spendable only when the canonical phase is `destination_available` and the runtime also returns `destinationAssetAvailable=true`. Quote, source acceptance, source finality, proof availability, proof verification, provider callback, destination submission, destination confirmation, failure, refund, recovery, and dispute do not independently make an asset spendable.

The client exposes `getHealth()`, `getVersion()`, and `getStateMachine()` so consumers can reject stale or unsupported runtime contracts before interpreting transfer state. Version `0.2.0` targets runtime schema `7` and state machine `ynx.bridge.lifecycle.v1`.

This package is locally tested and unpublished. No public Bridge endpoint, verified Bridge contract, connected provider, or live external route is implied.
