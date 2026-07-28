# YNX Music active plan

Status: ACTIVE
Stage: PROTECT
Branch: `codex/final-music`
Protected source checkpoint: `6cf7506b7eb150c6cfeebf2a8b147d8a5e22d605`

## Current evidence

1. Trust and Pay idempotency are account-scoped, atomic and legacy-compatible.
2. State mutation is copy-on-write and publishes memory only after durable save.
3. Startup verifies the outer state hash, every audit sequence/link/event hash, every track identity, private-media file type, private permissions and media SHA-256.
4. Missing, symlinked, permission-broadened or byte-tampered media fails startup closed.
5. iOS source fixes the throwing device-key call and MainActor callback isolation.
6. Local Go, Race, smoke, Wallet contract, 12-locale and Swift parse gates pass.
7. GitHub run `30381036379` passed Service, Android and the complete dynamic iOS Simulator gate against the exact source checkpoint.

## Current slice

Implement a versioned persisted-state migration registry plus schema-v1 golden compatibility, then add consistent state-and-media backup and clean-directory restore verification. Keep unknown future schemas fail closed and do not confuse ordinary restart with disaster recovery.

## Next gate

Bind run `30381036379` into release and platform evidence, then continue the versioned state migration and consistent state-and-media restore slice. Production signing, physical-device and store claims remain separate.
