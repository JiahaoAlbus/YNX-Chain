# Next Action

Highest-priority bounded delivery (2026-07-15):

Current single action: implement multi-device Chat recipient fan-out plus bounded device recovery/rotation, then verify the exact protocol in Go and the native mobile client without exposing plaintext or inventing a public message proof.

Why this is next:

- Exact Chat release `ynx-chain-f81f3b6cabe2` and App Gateway release `ynx-chain-376c95793d66` are remotely active with recoverable scoped backups.
- Public TLS and native-bound operator smokes now prove ownership/session/device binding and signed empty conversation-list reads. The Android 16 test-only Release renders the five native tabs and dedicated Chat/Pay windows.
- Current sending rejects recipients with zero or more than one active device. That is a real protocol limitation that blocks normal phone replacement and multi-device users; adding more UI before closing it would create unusable surfaces.

Files to touch:

- `internal/chat` envelope validation, persistence invariants, API handlers, and tests
- `apps/mobile/src/crypto/chatCrypto.ts`, Chat API parsing, client fan-out/decrypt logic, and native Chat states
- shared Go/TypeScript multi-recipient vectors and verification scripts
- API and acceptance documents only after real code exists

Required implementation:

- Define one message with immutable content identity and one authenticated encrypted envelope per active recipient device, including the sender's active devices when needed for conversation continuity.
- Bind every envelope to conversation ID, message ID, sender device, recipient account/device, algorithm, ephemeral public key, nonce, and ciphertext; reject missing, duplicate, extra, revoked, or changed-envelope replay.
- Keep the server ciphertext-only and preserve historical revoked public keys for old-message authentication while excluding revoked devices from new sends.
- Add bounded owner-authorized device rotation/recovery records with explicit old/new device evidence, replay protection, audit entries, persistence validation, and fail-closed behavior. Do not claim social recovery or hardware custody.
- Make the native App show per-device delivery/decrypt failures without falling back to plaintext or silently dropping a recipient.

Validation commands:

- `go test ./...`
- `make chat-api-check`
- `make app-account-ownership-check`
- `make app-gateway-check`
- `make mobile-check`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make preflight`
- `make objective-state-check`

Completion standard:

- Shared Go/mobile vectors prove deterministic metadata binding and decryption for at least two active recipient devices plus sender continuity.
- Unit/HTTP tests cover revoked devices, missing/duplicate/changed envelopes, replay, restart/tamper, authorization, and bounded recovery/rotation.
- Native Chat no longer rejects a valid recipient solely because more than one active device exists.
- No remote deployment or public message is claimed until the exact release is deployed and separately verified.

Explicitly not doing / truth boundaries:

- Do not add fake Bank, Shop, Bridge, AI, IDE, desktop, group, attachment, contact, or moderation screens.
- Do not claim WeChat equivalence, mainnet, exchange listing, stablecoin issuer support, wallet default support, store acceptance, partnership, public settlement, or independent proof without evidence.
- Do not expose Bridge as usable until external execution and custody/mint-burn authority exist.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
