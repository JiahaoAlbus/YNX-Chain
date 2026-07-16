# YNX Social handoff

## Source and baseline

- Branch: `codex/ecosystem-social`
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain-social`
- Required refreshed baseline: `62d98ee3635a825fdc425be7c93a869785bddf7b` (`origin/main`, fetched 2026-07-16; final rebase evidence is recorded below).
- Returned candidate baseline: `7f034342be9ed5eab3765c42238b22fb66673205`.
- Owned paths only: `apps/social/**`, `internal/social/**`, and this handoff.
- Native identity: Android/iOS `com.ynx.social`; deep link `ynxsocial://`.

## Delivered product

`apps/social` is an independent Expo/React Native application. Its only bottom navigation is People, Messages, Moments, Alerts, and Me. It uses Klein Blue `#002FA7`, white, black, and neutral gray; it has no Wallet, Pay, Exchange, Shop, or Network tab and does not recreate a mixed super App.

Identity and discovery:

- Canonical Wallet signed-envelope v1 for exact `requestingProduct=social`, `productClientId=ynx-social-v1`, `bundleId=com.ynx.social`, callback `ynxsocial://wallet-auth/callback`, sorted least-privilege scopes, five-minute lifetime, canonical JSON/request digest, derived-account verification, and compact low-S secp256k1 approval verification. The only Wallet deep-link query key is `request`; legacy query-field/`assertion` callbacks are rejected.
- Login is a two-stage Gateway exchange: verified Wallet approval creates a persistent, bounded, one-time server challenge and the App completes it with the exact Wallet-bound P-256 product-device key. Challenge substitution, signature tamper, replay, expiry, restart, and account/product/bundle/scope mismatch fail closed.
- Social creates only a P-256 product-auth device key plus separate Ed25519 signing and X25519 message-encryption device keys in platform secure storage. It never creates, imports, receives, or exports a Wallet recovery key. Existing message keys/device ID are migrated in place, reused across sign-out/sign-in, and the P-256 key is retained during chat-device rotation.
- Existing Square profiles remain authoritative for unique `@handle`, display name, and bio. Social adds avatar/privacy settings, a handle-only profile QR, expiring invite links, block, and mute.
- Contact requests support handle, consented contact match token, canonical profile QR, invite link, and recommendation sources. QR discovery has a real native camera scanner, requests camera permission only after the user chooses QR, strictly parses `ynxsocial://profile/@handle`-class payloads, and retains paste fallback when permission/camera is unavailable. User-facing wallet address discovery is rejected in both App and service boundaries.
- Phone matching requests native permission, canonicalizes only `+country-code` numbers on-device, and sends at most 500 domain-separated SHA-256 hashes. Raw address-book entries never leave the device.
- Request/accept/reject/withdraw/delete/block/mute flows are persistent, authorization checked, block aware, and rate limited.

Messaging:

- Existing Chat v2 is reused for private conversations, per-device X25519/HKDF-SHA256/XChaCha20-Poly1305 envelopes, Ed25519 sender proofs, delivered/read state, and direct-chat persistence.
- Social-owned groups support 3-16 accepted contacts, up to 32 active recipient devices, the same envelope/signature format, member authorization, tamper rejection, and restart recovery.
- The App creates private/group conversations, verifies every sender signature before decrypting, sends, renders sent/delivered/read state, acknowledges reads, and never renders `ynx1...` identities.
- The account-bound offline outbox stores ciphertext envelopes only in the App-private document directory, survives restart, retries idempotently, and reconnects when the App returns active. Device private keys stay in SecureStore.
- Search runs only over plaintext already decrypted on the current device; no search text or plaintext is sent to the server.
- Message images are independently XChaCha20-Poly1305 encrypted with a random attachment key and nonce, authenticated with conversation/name/type AAD, uploaded as ciphertext, and bounded below 25 MB including AEAD overhead. The key and metadata travel only inside the E2EE message. Download performs digest, AEAD, and signed-size verification.
- Product-device rotation requires the current signing key authorization plus the replacement signing-key proof, revokes the old device, migrates the session, and persists an exact retry record before the network call for response-loss recovery.

Moments, Trust, and alerts:

- Social-owned Moments persist text, up to four allowed media objects, public/contacts/private visibility, comments, four reaction types, follows, mentions, delete confirmation, reports, evidence fingerprints, outcome, and appeal.
- Public text may mirror to existing Square. Contacts/private content and message attachments never do. Visibility and media authorization are enforced server-side.
- Reporting is explicit. Trust receives a SHA-256 evidence fingerprint; the initial outcome states that review is pending and no penalty is automatic. Users can inspect the outcome, submit a correction/appeal, or explicitly request an AI explanation.
- Contact request, acceptance, comment, reaction, follow, mention, message received/delivered/read, unread, and mark-read alerts are persistent and account isolated. `square:` and `social:` alert IDs are dispatched to the correct source.

AI-native boundary:

- Reply draft, conversation summary, translation, inbox classification, and moderation explanation are implemented against a server-only streaming YNX AI Gateway client.
- Every run starts from one explicitly selected conversation/report, shows a privacy preview, provider, model, and estimated cost, and requires an explicit per-run permission.
- Streaming, cancel, provider failure, exact retry with new permission, review, accept/reject, correction/appeal, actual token/cost accounting, context hashing, and audit are persistent. Private context text is not persisted.
- Attachments, handles, contact lists, profile identity, Wallet identity, and recovery material are excluded from conversation AI context. Moderation AI receives only the selected outcome, official explanation, and evidence count.
- AI output is reviewable text only. No AI path can send a message, publish a Moment, follow, block, report, or punish. No automatic social action or automation rule is created by this package.
- AI output language is independently user-selected from the same 12 supported locales and is persisted in each AI job/audit input; it is not inferred from the UI locale.

Internationalization and accessibility:

- Audited locale set: English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português, Русский, العربية, and Bahasa Indonesia.
- Native locale detection uses the device locale; manual selection is stored in SecureStore and restored after restart. Arabic applies RTL at the React Native root and native layout manager.
- The typed catalogs enforce an identical, nonblank key set for all locales. Critical Wallet/security/recovery, privacy, permission, AI provider/model/cost/review, navigation, empty/retry/offline, and accessibility labels are localized; unknown bounded server detail fails to a nonblank English fallback.
- Date/time, number/cost, and plural helpers use `Intl`; protocol/legal signature bytes are deliberately not translated. A global localized Text/TextInput/Pressable layer also localizes visible strings, placeholders, and accessibility labels without changing cryptographic payloads.

Persistence and privacy:

- Social state uses strict JSON decoding, schema migration, atomic mode-`0600` writes, HMAC-SHA256 integrity, hash-chain audit, bounded inputs, idempotency, replay rejection, abuse limits, and startup tamper failure.
- Media uses private atomic files and every file is size/hash verified during startup. Corruption fails closed.
- Export includes Social settings, contacts, requests, notifications, AI jobs, product devices, groups, the user's group ciphertext records, owned media/Moments/comments/reactions/reports, automation records, and relevant audit events.
- Delete removes Social-owned settings, relationships, alerts, AI jobs, sessions, blocks/mutes, product devices, group membership/user messages, owned media files, Moments/comments/reactions/reports, automation records, plus all local session/device/outbox/rotation material.

## Verification evidence

- `go test ./internal/social` and `go test -race ./internal/social`: pass. Coverage includes canonical Wallet request/approval and P-256 challenge/completion, strict parser and legacy-query rejection, approval/challenge replay, P-256 tamper, challenge restart recovery, product proof, Chat/Square registration, contact lifecycle and abuse limits, account authorization, direct/group E2EE state, signature/AEAD tamper, idempotent send, read/delivered state, device rotation and exact retry, persistence/restart/migration, state/media tamper, Moments visibility/media/comments/reactions/report/appeal/delete, AI permission/locale/stream/cancel/failure/retry/review, and privacy export/delete.
- `npm ci --ignore-scripts --no-audit --no-fund`: pass from the committed lockfile.
- `npm run check`: pass; TypeScript, 12 crypto/policy/Wallet/i18n tests, and Android+iOS Hermes exports pass.
- `npm run smoke`: pass; canonical single-envelope Wallet transport, independent identity/deep link, camera QR, 12 locales, recovery-key boundary, discovery boundary, permissions, and allowed navigation are checked.
- `make no-placeholder-check`, `make secret-scan`, and `make env-check`: pass on the final Social worktree; no generated credentials, recovery material, deployment filler, or real environment values are included.
- Android `assembleDebug` and arm64 `assembleRelease`: pass with JDK 17 and SDK 36. Release uses local debug test signing only; no signing key is in the repository.
- Release APK SHA-256: `3aed04160afa8d387ffbdff91fd12c047623278cfccad01dfbac8eb91cac11df`.
- Android emulator install: pass. Final cold launch: `LaunchState: COLD`, `TotalTime: 3526 ms`; process remained alive and the post-launch log contained no fatal exception.
- Accessibility tree exposes the product title, description, endpoint failure state, exact `Sign in with YNX Wallet` button label, and recovery-key boundary.
- Screenshot: `apps/social/evidence/android-release-signin.png`; SHA-256 `daa767524c40807075c5cc4624db1419443c9d37bb1d301cfd797d01071cc91c`.
- iOS native project generation and iOS Hermes bundle: pass. A native Xcode compile cannot run on this host because `xcode-select` points to `/Library/Developer/CommandLineTools` and full Xcode is absent.
- `go test ./...`: all Social/Chat/Square and most repository packages pass. The repository-wide command remains red only in baseline `internal/bftgateway` and `internal/consensus` tests because `artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json` is absent. This branch does not own that artifact.

## Central integration requests

1. Construct and expose `internal/social` in the central daemon/process layer with the existing Chat and Square services, the reviewed discovery/contact-hash resolver, persistent state/token keys, and a server-side YNX AI Gateway client. Central files were intentionally not edited here.
2. Integrate the shared `packages/wallet-auth` package after the Wallet branch lands, and register exactly `social` / `ynx-social-v1` / `com.ynx.social` / `ynxsocial://wallet-auth/callback` / `account:read,profile:link` / `p256-sha256`. This product already uses a byte-compatible local canonical adapter because Social cannot edit the shared package before central integration; do not reintroduce the rejected `com.ynxweb4.social` test identity or legacy query fields.
3. Configure `EXPO_PUBLIC_YNX_SOCIAL_API_BASE` to the reviewed HTTPS ingress only after the central service has TLS, backup/rollback, health, and abuse-monitoring evidence. The release currently fails closed and visibly reports that the endpoint is unset.
4. Add central Square and Chat privacy erasure/export APIs, then orchestrate them from Social. This branch fully deletes/exports Social-owned records but cannot truthfully erase Square-owned profile/public posts or Chat-owned direct-conversation ciphertext without modifying those central products.
5. Supply production Android/iOS signing only through release infrastructure. Run the native iOS archive/install/cold-launch/accessibility suite on a full-Xcode host.
