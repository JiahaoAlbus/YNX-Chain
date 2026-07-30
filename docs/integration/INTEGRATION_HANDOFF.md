# YNX Bridge Integration Handoff

Updated: 2026-07-30T12:02:10Z

Status: remote Testnet coordinator, canonical App Gateway integration, public read-only ingress, and supported external-route Provider API probe deployed; approved YNX Provider route, YNX contracts, funded transfer execution, and cross-owner acceptance are not complete.

Deployed Testnet runtime commit: `857371f9b19422861c0675ca6cbd89a7750744ad`  
Frozen release source commit: `40b99be92a9fd7a1e83cab3da27bbe233bf2695c`
Latest successful Bridge CI: `https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/30419513969`
Verification artifact digest: `sha256:bb1185235fd22cdfae5b98efdb723b1b70f48f32aea7c4dd0d42fae6c506e54f`
Published unsigned candidate: `https://github.com/JiahaoAlbus/YNX-Chain/releases/tag/ynx-bridge-v0.3.1-testnet-candidate`

Integration contract: `release/integration/ynx-bridge-contract.json`  
Cross-product vectors: `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`

## Frozen lifecycle boundary

Consumers must use state machine `ynx.bridge.lifecycle.v1` and runtime schema `7`. The runtime exposes `GET /version` and `GET /bridge/state-machine`; consumers must reject unsupported or stale versions.

`proof_attestation_available` is not `proof_verified`. `destination_mint_release_submitted` is not destination confirmation. `destination_mint_release_confirmed` is not destination asset availability. The only positive availability state is `destination_available`, and consumers must additionally require `destinationAssetAvailable=true`.

Pay must not execute payment and Exchange must not credit a deposit before that dual availability condition. Provider webhook status must never be promoted to source finality, proof verification, destination confirmation, or asset availability.

## Protected mutation boundary

The public SDK is read-only and contains no Bridge API key, provider credential, relayer key, Wallet secret, private key, seed, or signing authority. The deployed canonical App Gateway mediates digest-bound quote and Wallet review generation with Product Session, account, device, expiry, and scope context; Wallet signature integration remains incomplete. The Bridge service never signs the user's source transaction.

The current implemented proof verifier revalidates domain-separated threshold-relayer attestations. It is not a light client, does not prove independent consensus, and does not authorize a canonical or trustless Bridge claim.

## Current fail-closed status

The remote Testnet coordinator and canonical App Gateway upstream are directly verified active for release `ynx-bridge-857371f9b194`. The combined App Gateway preserves the canonical Wallet sidecar boundary and Bridge Product Session routes; both upstreams were directly healthy at the final observation. Its systemd unit treats Wallet as a soft `Wants` dependency rather than a hard `Requires` dependency, preventing an unrelated Wallet failure from forcing Bridge ingress restarts. Public TLS read-only health, version, status, route, provider, asset, transparency, and state-machine paths are verified through `https://rest.ynxweb4.com/app/bridge`; the coordinator itself remains loopback-only and no public mutation route exists. The deployed Circle CCTP V2 Sandbox probe is connected for the supported Ethereum Sepolia domain 0 to Base Sepolia domain 6 route and refreshes its successful observation every 60 seconds. A real service-account egress outage was independently observed through the public surface to fail closed with zero available Providers; removing the outage restored Provider connectivity automatically. Eight integrity-linked outage and recovery events were then verified through the public Provider Registry and retained with identical identifiers and state-file SHA-256 across a coordinator restart. Runtime metrics expose active outage state and incident totals, while Monitor delivery remains explicitly undeployed. Agreement and operational review approval, route availability, quote execution, external submission, and user asset movement remained false throughout. YNX is not listed in the inspected official references, so no verified YNX provider connection, verified YNX source/destination contracts, official YNX stablecoin route, public Testnet deposit, public Testnet withdrawal, or independent security review exists.

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
- `28-website`: publish only evidence-backed `/bridge` status and documentation, and replace the generic SPA shell metadata with route-specific canonical, title, description, Open Graph and JSON-LD records. The product route returns HTTP 200, but product-specific metadata was not verified on 2026-07-29.
