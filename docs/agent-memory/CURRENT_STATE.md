# YNX Music current state

Updated: `2026-07-29T02:57:07Z`

## Identity

- Product: `32 — YNX Music`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/32-music`
- Branch: `codex/final-music`
- Repository: `https://github.com/JiahaoAlbus/YNX-Chain.git`
- Verified runtime source SHA: `22653153c62529f782f44b0a35177b531ae7e8af`
- Evidence checkpoint SHA observed before this memory update: `38d51649edb857328bffc0da6b0b805de4973536`
- Remote branch SHA at observation: `38d51649edb857328bffc0da6b0b805de4973536`
- `origin/main`: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Ahead / behind at observation: `0 / 0`
- Dirty state at observation: clean

The commit containing this file is the checkpoint carrier and may be one commit after the observed SHA above. Resolve the authoritative current carrier with `git rev-parse HEAD`; do not infer it from timestamps.

## Current phase

`PROTECT / ACTIVE` — core local integrity and recovery gates are green. Central integration, shared Testnet, public deployment, hosted downloads, production signing and store release remain unverified.

## Latest successful tests

- `go test ./internal/music`
- `go test -race ./internal/music`
- `go test ./apps/music/...`
- `go vet ./internal/music ./apps/music/...`
- `go build ./apps/music/cmd/ynx-musicd`
- Exact-source GitHub workflow `music-platforms`, run `30417406111`, conclusion `success`
  - Service: success
  - Android: success, CI artifact upload success
  - iOS Simulator: success, build/install/cold start/tampered callback rejection/restart

Repository-wide `go test ./...` is not green because another Owner's generated DevTools artifact is absent: `artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json`. All Music packages passed.

## Pull requests and release

- Open or historical PRs from `codex/final-music`: none returned by GitHub.
- Music GitHub Release: none.
- Release class: local Testnet candidate only.
- `product-release.json`: bound to runtime source SHA `22653153c62529f782f44b0a35177b531ae7e8af` and CI run `30417406111`.

## Artifacts

- Android and iOS Simulator artifacts were uploaded by CI run `30417406111`.
- GitHub artifact inventory retrieval failed on two bounded attempts with TLS handshake timeout.
- `ARTIFACT_MANIFEST.json` remains an older local artifact manifest tied to source `74716a19d95fc191b54102adc02000a91fafec24`; it must not be represented as the exact current artifact inventory.
- Hosted immutable downloads: false.
- Production signatures: false.
- SBOM exists locally, but exact-current artifact provenance and reproducibility are not verified.

## Public deployment and website

- Public runtime: false.
- Website publication: false.
- Canonical product route: `/music` under `https://ynxweb4.com`.
- `ynxweb4.com/music` deployment has not been directly verified and must remain false.
- No Music file under `apps/music` incorrectly uses `huangjeo.com` as the YNX product website.

## Completed in the latest slice

- State schema v2 and versioned migration registry.
- Verified schema-v1 golden compatibility and atomic v1→v2 persistence.
- Fail-closed future, tampered and non-advancing migration handling.
- Consistent state-plus-media backup manifest with SHA-256 and byte counts.
- Clean-directory restore with state, audit, media and permission verification.
- Non-overwrite backup and restore behavior.
- Operator `-backup` and `-restore` modes.
- Exact-SHA green Service, Android and iOS Simulator CI.
- Release, evidence, public metadata, migration and operations truth updated.

## Remaining high-priority work

1. Add a non-empty schema-v1 golden containing tracks, artwork, listener history, Trust/Pay replay keys and audit events.
2. Define and test schema-v2 downgrade or explicit minimum-compatible-version policy.
3. Run a remote restore rehearsal and measure RTO/RPO and storage growth.
4. Obtain central Wallet/Auth, Pay/Data Fabric, Trust and AI acceptance plus shared-Testnet negative vectors.
5. Obtain Android physical-device installation/cold-start evidence.
6. Generate exact-current artifact inventory, SHA-256, SBOM/provenance and immutable hosted downloads.
7. Complete Website Owner handoff and independently verify `https://ynxweb4.com/music` after deployment.

## Current risks

- No central owner acceptance or shared-Testnet proof.
- No licensed public catalog or independent non-test rights review.
- No remote disaster-recovery evidence or measured objectives.
- No production signing, public download, public runtime or store release.
- Full-repository test gate depends on another Owner's missing generated contract artifact.
