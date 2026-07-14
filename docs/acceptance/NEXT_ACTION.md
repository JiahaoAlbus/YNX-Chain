# Next Action

Current single action: build the YNX-native wallet identity and device-signing foundation required by first-party applications, then use it for the first bounded YNX Chat service slice.

Why this action:

- Release `ynx-chain-fb6f1726719b` and website `8cb3d3c` now make `ynx1...` the default first-party display while keeping standard MetaMask and EVM JSON-RPC inside an explicit `0x...` compatibility boundary.
- A converter is not a production native wallet. Secure device identity, signing, encrypted backup/recovery, owner handover, and an independently reviewable application boundary are still missing.
- The user added YNX Chat as a full-ecosystem requirement. It is currently target state only and must become executable code before it appears as live on the website.
- Native wallet/device identity is the prerequisite for signed conversations and should be implemented before broad Chat features.

Required wallet foundation:

- Default all first-party account output and inputs to checksummed `ynx1...`; keep `0x...` only in a named EVM compatibility adapter.
- Use a proven cryptographic library for key generation, signing, verification, KDF, authenticated encryption, and secure random generation; do not hand-roll cryptography.
- Separate account identity from device keys and support device registration, revocation, rotation, backup/recovery metadata, and owner-handover evidence.
- Never log or return mnemonics, private keys, recovery secrets, or plaintext encrypted backups from a service API.
- Add deterministic public test vectors, unit/race tests, strict persistence permissions, tamper/restart tests, smoke/check commands, and Makefile targets.

First bounded YNX Chat slice:

- Add a standalone daemon with authenticated APIs for device registration, direct conversation creation, encrypted-envelope submission, conversation/message lookup, delivery acknowledgement, and read acknowledgement.
- Persist only ciphertext envelopes plus bounded routing/audit metadata. Do not put private message content on the public chain.
- Bind senders and recipients to normalized `ynx1...` identities; reject malformed identities, unknown/revoked devices, replayed/conflicting message IDs, oversized payloads, and unauthorized conversation access.
- Add hash-chained redacted audit, rate limits, health/metrics, atomic mode-`0600` persistence, mutation-freeze behavior, deployment env templates, systemd/release/backup/rollback wiring, and API documentation after code exists.
- Keep group chat, attachments, voice/video, moments/feed, bots, payments, Trust reports, appeals, moderation, and multi-device recovery explicitly incomplete until each has code and tests.

Files to touch:

- new bounded wallet/device identity packages and command paths following existing `internal/*` and `cmd/*` service patterns
- new bounded Chat package and daemon, deployment env/systemd/backup wiring, verification scripts, and Makefile targets
- API and ecosystem documentation only after the handlers and tests exist
- `FEATURE_COMPLETION_TRACKER.md`, `PROJECT_STATE.md`, and `NEXT_ACTION.md` after each verified slice
- the website only after an exact public deployment is verified

Validation commands:

- `go test ./...`
- `go test -race` for the new wallet/device and Chat packages
- `make native-wallet-check`
- `make chat-api-check`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Real wallet/device and Chat code exists with tests, restart/tamper/replay/access-control proof, smoke targets, and deployable service wiring.
- Local completion is recorded honestly. Remote/public status stays false until the exact release is deployed and verified.
- The website receives a YNX Chat surface only after the daemon is publicly reachable and verified; before that it may only describe Chat as target state.
- Standard MetaMask remains a compatibility adapter and is not claimed to display `ynx1...` or provide wallet-default support.

Explicitly not doing:

- No claim of WeChat-equivalent completeness from a messaging MVP.
- No plaintext message or key material on chain, in logs, in commits, or in transparency reports.
- No custom cryptographic primitives, fake E2EE claim, mainnet claim, wallet-vendor default claim, exchange listing claim, or partnership claim.
- No bounded EVM opcode, Counter sample, Hardhat artifact, or IDE execution expansion.
- No public BFT freeze, signer install, candidate start, ingress switch, or cutover without existing independent approvals.
- Do not modify or replace the long-term goal file.
