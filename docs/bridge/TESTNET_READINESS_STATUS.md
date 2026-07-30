# YNX Bridge Testnet Readiness Status

Updated: 2026-07-30T12:02:10Z
Product: `21 — YNX Bridge & Interoperability`
Branch: `codex/final-bridge`
Frozen release source commit: `40b99be92a9fd7a1e83cab3da27bbe233bf2695c`

## Status matrix

| State | Value | Direct evidence boundary |
| --- | --- | --- |
| recovered | true | Worktree, branch, remote, history, evidence, public endpoints, and CI were re-audited. |
| implementedLocal | true | Bridge coordinator, App Gateway integration, SDK, Provider runtime, observability, migration, restore, and supply-chain gates exist. |
| testedLocal | true | Focused race tests and Bridge verification targets passed on 2026-07-29 after the restore-port defect was fixed. |
| installedLocal | true | The downloaded SDK installed/imported and the downloaded host binary passed configuration validation plus a real cold start. |
| integratedCentral | true | Canonical App Gateway Bridge Product Session routes and Wallet-sidecar compatibility are deployed. Consumer-owner acceptance is still incomplete. |
| testnetVerified | false | No funded YNX deposit or withdrawal exists. |
| deployedStaging | true | Remote Testnet coordinator and Provider observation are deployed. |
| deployedPublic | true | Public read-only status/evidence is reachable through TLS. Public mutation and asset movement remain disabled. |
| releasePublished | true | GitHub pre-release `ynx-bridge-v0.3.1-testnet-candidate` is published at frozen source `40b99be9…`. |
| downloadHosted | true | Ten immutable candidate assets are hosted with SHA-256, SBOM, provenance, notices and installation instructions. |
| productionSigned | false | Existing builds are unsigned Testnet candidates. |
| mainnetReleased | false | Mainnet and production asset movement are not claimed. |

## Verified runtime truth

Public read-only base URL: `https://rest.ynxweb4.com/app/bridge`

The 2026-07-29 direct status observation reported:

- coordinator available
- live Provider API observation available on supported non-YNX domains
- `externalSubmissionEnabled=false`
- `userAssetMovementEnabled=false`
- `officialStablecoinRouteAvailable=false`
- `quoteExecution=false`
- `sourceSubmission=false`
- `destinationMintRelease=false`
- `refundExecution=false`
- zero transfers and zero open-exposure transfers
- build `857371f9b194`

This proves public read-only Testnet evidence, not an executable YNX Bridge route.

## Completed engineering gates

- schema-v7 persistence and v1-v6 migration
- frozen 19-state lifecycle contract
- explicit proof-verification and destination-availability gates
- replay, tamper, duplicate, changed-idempotency, and double-settlement rejection
- threshold-relayer signature/quorum verification
- route, user, Provider, daily, and large-transfer controls
- pause/resume, failure, retry, recovery, refund, dispute, and correction semantics
- reconciliation, exposure, retention, export, deletion, cessation, backup, restore, and rollback evidence
- canonical App Gateway Product Session mediation
- read-only SDK and cross-product lifecycle vectors
- Circle CCTP V2 Sandbox fee/health observation with fail-closed YNX route status
- structured metrics, alerts, dashboard, request IDs, trace context, and incident history
- reproducible Linux/AMD64 build check, SPDX SBOM generation, dependency audit, and secret/placeholder gates
- reproducible Linux/AMD64 and macOS/ARM64 release candidates plus SDK packaging
- independent release download, checksum, SDK install/import and binary cold-start verification

## Recovered defect

The restore gate previously bound every drill to TCP port `16435`. A concurrent or stale listener could cause a false recovery failure. Commit `96a64792a6343ec379763bc7e382c1d0a4a75f3d` isolates every restore drill on a dynamically selected loopback port. A normal restore drill and two simultaneous drills passed after the repair.

## Missing Testnet completion evidence

The following remain false and may not be promoted:

- approved executable YNX Provider or proof-based route
- verified source and destination Bridge contracts
- YNX issuer or canonical stablecoin attestation
- funded Testnet deposit
- funded Testnet withdrawal
- destination mint/release execution
- real refund execution
- production HSM/MPC or signer ceremony
- independent security review
- shared Testnet acceptance by all central owners
- Monitor delivery and public incident integration

## Website audit

`https://ynxweb4.com/bridge` returns HTTP 200, but the fetched SPA shell still advertises the root canonical URL, generic site title, and generic description. Therefore the `/bridge` route is publicly reachable but product-specific SEO/Canonical/JSON-LD completion is not proved. Owner `28-website` must publish route-specific metadata without changing the Bridge truth boundary.

## Required end-to-end acceptance sequence

1. Wallet reviews a digest-bound route and signs the source intent.
2. Source transaction is submitted, accepted, finalized, and linked to explorer evidence.
3. Proof or attestation becomes available and is independently verified under the selected route model.
4. Destination mint/release is submitted and confirmed.
5. Asset availability is set only at `destination_available` with `destinationAssetAvailable=true`.
6. Reconciliation proves locked/burned/minted/released amounts and exposure without double counting.
7. Failure, retry, refund/recovery, replay rejection, limits, pause, and dispute paths are evidenced.
8. Deposit and withdrawal evidence is publicly accessible and bound to an exact source commit and release.

## Current decision

Goal status: **ACTIVE**.
Current phase: **TESTNET**.
Reason: public read-only evidence and staging runtime exist, but executable YNX asset movement and funded end-to-end Testnet evidence do not.
