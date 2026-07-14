# Next Action

Highest-priority bounded delivery (2026-07-14):

Build one real YNX-native browser signing boundary and use it to deliver the first signed Square Web/PWA write workflow against remotely active App Gateway release `ynx-chain-132b711450f6`.

Current single action: implement and verify client-owned `ynx1...` account proof, device-key registration, account-bound session establishment, and signed Square post/comment/reaction/follow/report requests. Private keys must never enter Vercel functions, App Gateway requests, service environments, logs, analytics, or repository state. The production Square page remains read-only until the client storage, signing, revocation, and failure paths pass focused tests and remote non-content smoke.

Why this action:

- The remote ownership/session gap is closed for operator-controlled source-bound proof: exact Gateway release `132b711450f6` completed chain-account proof, Ed25519 device binding, Chat/Square registration and signed revocation, session revocation, state restart, public read continuity, rollback recovery, and chain continuity.
- The website already exposes real persisted Square reads, but users cannot yet prove account ownership or sign mutations in the browser. Adding more routes or empty ecosystem windows would not close that usability gap.
- Direct Chat and Square service keys remain loopback-only. A browser client must call only `/app/session/*` and `/app/square/*`, keep account/device secrets client-side, and sign the canonical upstream `/square/*` request URI required by the deployed Gateway.
- Square moderation decisions, Trust appeal execution, and Pay tips are still missing. The first UI must label those functions unavailable rather than simulate them.

Required implementation:

- Add a reviewed browser-capable signer package with deterministic `ynx1...` derivation, canonical ownership sign bytes, low-S secp256k1 signatures, Ed25519 device signatures, and exact Square request-signature generation matching Go vectors.
- Store encrypted key material only in local browser storage with an explicit lock/unlock boundary, bounded idle/session lifetime, versioned ciphertext metadata, authenticated encryption, and a user-controlled backup/export acknowledgement. Never silently upload or log key material.
- Support import and creation as separate explicit flows. Display the derived `ynx1...` address before any registration. Do not claim hardware-wallet, social recovery, custody, or wallet-vendor support.
- Implement challenge creation, ownership verification, session expiry/revocation, Square device registration/revocation, and signed post/comment/reaction/follow/report clients with exact-origin and idempotency handling.
- Add focused cross-language vectors and tests for account derivation, sign bytes, DER low-S canonicalization, device proof, request URI/query binding, encrypted storage tamper rejection, wrong password, replay, expiry, logout/revocation, and zero secret leakage into network payload snapshots.
- Add the production Square compose and interaction states only after the signer tests pass. The UI must show locked, connecting, ready, expired, revoked, offline, and server-rejected states and continue to render public reads without a session.
- Run a remote non-content smoke through `https://api.ynxweb4.com`, then deploy the website. Do not create a public post unless the owner explicitly approves the exact content and signing account.
- After the signed Square workflow is verified, reuse the same client boundary for Chat. Do not start Bank, Shop, broad route expansion, or bounded EVM/IDE expansion in this slice.

Files to touch:

- `sdk/js` or a new narrowly scoped first-party browser signer package with shared test vectors
- `scripts/verify` and `Makefile` for browser signer and Square client checks
- `/Users/huangjiahao/Desktop/YNX-Chain-website` Square route, client-side signer/storage modules, and same-origin session/mutation functions only where necessary
- `docs/api/API_REFERENCE.md` only after matching code and tests exist
- `FEATURE_COMPLETION_TRACKER.md`, `PROJECT_STATE.md`, and `NEXT_ACTION.md` after verification

Validation commands:

- `go test ./...`
- `make native-wallet-check`
- `make square-api-check`
- `make app-account-ownership-check`
- `make app-gateway-check`
- new browser signer/client check target
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`
- website `npm test`
- website `npm run build`
- production desktop/mobile Square interaction and public-read checks

Completion standard:

- A user can create or import a YNX-native account locally, see the derived `ynx1...` address, unlock it, establish an account-bound session, register the device, and sign supported Square actions without sending private material to any server.
- Lock, logout, expiry, revocation, reload, wrong password, corrupted ciphertext, wrong origin, and rejected signatures fail visibly and safely.
- Production remains truthful: public reads may be live, but write capability is not labeled usable until the deployed client and remote protected flow are verified.
- Chat UI, moderation decisions, Trust/appeal execution, Pay tips, media, groups, full recovery, macOS/Windows packaging, Bank, Shop, and broader ecosystem routes remain explicitly incomplete.

Explicitly not doing / truth boundaries:

- Do not expose mnemonics, private keys, recovery secrets, session tokens, Chat/Square service keys, or plaintext private messages to servers, logs, commits, analytics, screenshots, or chain state.
- Do not treat a generated browser key as completed custody, backup, recovery, or owner handover.
- Do not claim an owner-approved public post until one is deliberately signed and observed in the persisted feed.
- Do not claim independent public proof from operator-controlled source-bound checks.
- Do not claim WeChat-equivalent completeness, wallet default support, mainnet, exchange listing, stablecoin issuer support, third-party partnership, automated punishment, or native YNXT freeze authority.
- Do not expand bounded EVM opcode, Counter sample, Hardhat artifact, or IDE work except to preserve passing tests.
- Do not modify or replace the long-term goal file.
