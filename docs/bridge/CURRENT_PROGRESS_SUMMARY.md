# YNX Bridge Current Progress Summary

Updated: 2026-07-30T12:02:10Z

## Authoritative recovery state

- Product: `21 — YNX Bridge & Interoperability`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/21-bridge`
- Branch: `codex/final-bridge`
- Frozen release source commit: `40b99be92a9fd7a1e83cab3da27bbe233bf2695c`
- Remote: `https://github.com/JiahaoAlbus/YNX-Chain.git`
- Local and remote branch were synchronized immediately after the protected implementation push.
- The previous summary dated 2026-07-23 is superseded. Its claim that canonical App Gateway integration was not implemented is no longer true.

## Directly verified capabilities

- Schema-v7 persistent transfer coordinator and the frozen `ynx.bridge.lifecycle.v1` state machine.
- Domain-separated threshold-relayer attestation verification, replay rejection, exact idempotency, and startup integrity revalidation.
- Explicit separation of source finality, proof availability, proof verification, destination confirmation, and destination asset availability.
- Fail-closed route, Provider, asset, quote, Wallet review, limits, pause, recovery, refund, dispute, reconciliation, export, retention, and cessation boundaries.
- Canonical App Gateway Product Session mediation for Bridge quote and Wallet review paths.
- Public TLS read-only Bridge evidence at `https://rest.ynxweb4.com/app/bridge`.
- Deployed Circle CCTP V2 Sandbox Provider observation on supported non-YNX domains, while YNX route execution remains unavailable.
- Public product route `https://ynxweb4.com/bridge` returns HTTP 200.
- Immutable GitHub pre-release `ynx-bridge-v0.3.1-testnet-candidate` hosts two reproducible unsigned coordinator binaries, the read-only SDK, SPDX SBOMs, provenance, checksums, installation instructions and notices.
- All ten release assets were downloaded independently and their checksums passed; the SDK installed/imported and the macOS ARM64 binary passed configuration validation and a real cold start.

## Current truth boundary

The deployed surface is a public read-only Testnet evidence service, not an executable YNX Bridge. The runtime currently reports:

- `externalSubmissionEnabled=false`
- `userAssetMovementEnabled=false`
- `officialStablecoinRouteAvailable=false`
- no funded YNX deposit or withdrawal
- no verified YNX source/destination Bridge contracts
- no light-client or trustless canonical Bridge proof
- no production signer ceremony or independent security acceptance

Threshold-relayer attestations must not be described as a canonical or trustless Bridge.

## Recovery defect fixed in this session

`make bridge-restore-check` used a fixed TCP port and could fail when another process occupied that port. Commit `96a64792a6343ec379763bc7e382c1d0a4a75f3d` now allocates an isolated loopback port for every restore drill. The repaired check passed independently and two restore drills passed concurrently.

## Published unsigned candidate

- Release: `https://github.com/JiahaoAlbus/YNX-Chain/releases/tag/ynx-bridge-v0.3.1-testnet-candidate`
- Source: `40b99be92a9fd7a1e83cab3da27bbe233bf2695c`
- CI: run `30419513969`, job `90473200772`, successful
- Linux AMD64: 7,274,644 bytes, SHA-256 `0836bc034dfd5b8d3e6e58947ab7e42751d84bc6a2cee26df654aead55ce34b4`
- macOS ARM64: 6,917,570 bytes, SHA-256 `2e0756979ae693292dd2e1eb281253f866baad53e204b165817f083195e0b164`
- SDK 0.3.1: 7,659 bytes, SHA-256 `dbbdd2a27a2131b43800d732791ec832a6daf0ae2fb584cddd7efff51581f47c`
- Signing class remains `unsigned-testnet-candidate`; publishing this candidate does not enable execution or user asset movement.

## Latest focused verification

Passed locally on 2026-07-29:

- `go test -race ./internal/bridgegateway ./cmd/ynx-bridged ./internal/appgateway ./cmd/ynx-app-gatewayd`
- `make bridge-api-check`
- `make bridge-integration-check`
- `make bridge-supply-chain-check`
- `make bridge-observability-check`
- `make bridge-dependency-audit-check` — 86 packages, 0 advisories
- `make bridge-sdk-check`
- `make bridge-route-adapter-check`
- `make bridge-provider-check`
- `make bridge-data-lifecycle-check`
- `make bridge-capacity-check`
- `make bridge-migration-check`
- `make bridge-restore-check`
- two concurrent restore drills

The first grouped verification exposed the fixed-port restore defect; the repaired isolated-port drill then passed.

## Current highest-priority remaining work

1. Obtain explicit dependency acceptance from Wallet/Auth, Chain, Data Fabric, Security/SRE, Integration, Monitor, Explorer, Governance, and Website owners.
2. Correct Website route metadata so `/bridge` has a product-specific canonical URL, title, description, and structured data instead of the generic SPA shell metadata.
3. Obtain an approved Provider/proof route, verified contracts, funded Testnet assets, secure signer path, and independent security acceptance.
4. Execute and publicly prove at least one deposit, one withdrawal, failure/retry/refund, replay rejection, limits, pause, destination evidence, and reconciliation.

Goal status remains **ACTIVE**. Public read-only evidence is deployed; executable Bridge asset movement is not.
