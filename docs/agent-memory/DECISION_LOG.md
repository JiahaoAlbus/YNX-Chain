# Decision log

## 2026-07-29 — Recover from final worktree, not chat state

The Fable5 product identity, MCP 33 workspace, expected worktree, branch and `JiahaoAlbus/YNX-Chain` remote matched. The real repository and GitHub state were used as authority; stale `.ai-bridge` commit references were corrected.

## 2026-07-29 — Hash every playable media asset

The former model persisted only the original upload digest and exposed an HLS playlist without per-derivative integrity metadata. YNX Video now inventories the playlist and every segment, hashes each asset, records bytes and lineage, and binds derivatives to the original digest.

## 2026-07-29 — Fail closed during legacy migration

Schema v2 startup backfill reads existing objects to populate integrity metadata. When a legacy derivative is missing or unverifiable, the video becomes private and failed with an audit event. It is not left published and it is not silently regenerated during migration.

## 2026-07-29 — Separate current source from historical artifacts

Historical Android debug and iOS Simulator hashes/install evidence remain preserved, but `apps/video/product-release.json` marks them not current for the final source commit. Current-source `installedLocal`, public deployment, hosted download, signing and store-release flags remain false.

## 2026-07-29 — Integration contract v2 is a handoff, not acceptance

`ynx-video-integration-v2` includes media-integrity fields and fail-closed legacy semantics. Its existence proves product-owned implementation and local verification only; YNX 29 central acceptance and shared-testnet execution remain separate states.

## 2026-07-29 — Installed scanner is not a ready scanner

ClamAV 1.5.3 exists locally, but `freshclam.conf` is unparsable and the default database directory contains no supported signatures. The evidence is classified as execution infrastructure, while YNX Video remains fail closed and `testnetVerified` remains false.

## 2026-07-29 — Local restore evidence is scope-qualified

The current-source recovery CLI restored a minimal initialized schema-v2 store with matching state hashes and successful reopen. `restoreVerified` is true only for that local scope; populated media-object, remote durable storage, HA and production disaster recovery remain false.
