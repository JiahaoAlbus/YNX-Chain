# YNX Bridge Integration Handoff

Status: local implementation tested; central integration, Testnet deployment, provider connection, and contract deployment are not complete.

Source runtime and consumer contract commit: `3921629d5deb8cdcab8077d487639b1255f15b23`  
Integration contract: `release/integration/ynx-bridge-contract.json`  
Cross-product vectors: `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`

## Frozen lifecycle boundary

Consumers must use state machine `ynx.bridge.lifecycle.v1` and runtime schema `7`. The runtime exposes `GET /version` and `GET /bridge/state-machine`; consumers must reject unsupported or stale versions.

`proof_attestation_available` is not `proof_verified`. `destination_mint_release_submitted` is not destination confirmation. `destination_mint_release_confirmed` is not destination asset availability. The only positive availability state is `destination_available`, and consumers must additionally require `destinationAssetAvailable=true`.

Pay must not execute payment and Exchange must not credit a deposit before that dual availability condition. Provider webhook status must never be promoted to source finality, proof verification, destination confirmation, or asset availability.

## Protected mutation boundary

The public SDK is read-only and contains no Bridge API key, provider credential, relayer key, Wallet secret, private key, seed, or signing authority. Future mutations must be mediated by the accepted App Gateway and a canonical Wallet review/signature flow. The Bridge service never signs the user's source transaction.

The current implemented proof verifier revalidates domain-separated threshold-relayer attestations. It is not a light client, does not prove independent consensus, and does not authorize a canonical or trustless Bridge claim.

## Current fail-closed status

No verified provider connection, verified source/destination Bridge contracts, public Bridge deployment, official stablecoin route, public Testnet deposit, public Testnet withdrawal, or independent security review is evidenced by this worktree. Route execution therefore remains unavailable and all release booleans beyond local implementation/testing remain false.

## Owner actions

- `01-chain-core`: provide versioned source/destination finality evidence contract and reorg semantics.
- `02-wallet-auth`: accept Wallet review tuple, signed intent, Product Session, expiry, and revoke contract.
- `04-pay`: enforce `destination_available` plus explicit availability flag before payment.
- `07-exchange`: enforce the same gate before deposit credit and expose withdrawal lifecycle.
- `09-dex`: label routes external and consume slippage/finality/refund status without asset custody.
- `12-explorer`: render source event, proof status, destination transaction, confirmation, and availability evidence separately.
- `13-monitor`: alert on proof failure, stale pending state, provider health, exposure, reconciliation, limits, pause, and incidents.
- `15-trust`: consume dispute, appeal, evidence, and correction events without asset authority.
- `17-economics`: accept reserve, supply, liability, and exposure fields without counting locked assets twice.
- `19-oracle`: provide versioned valuation and route-risk inputs.
- `26-data-fabric`: freeze canonical event envelopes and Saga identifiers.
- `30-security-sre`: accept secret/signer boundaries, backup, release, and incident controls.
- `31-governance`: accept provider, limit, pause, contract, and timelock control surface.
- `29-integration`: freeze the unique protocol version and shared Testnet sequence.
- `28-website`: publish only evidence-backed `/bridge` status and documentation.
