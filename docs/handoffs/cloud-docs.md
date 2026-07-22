# YNX Cloud & Docs handoff

## Scope and truthful release boundary

- Delivery worktree: designated Cloud final worktree
- Branch: `codex/final-cloud`
- Minimum preserved baseline: `7b3c5f427c1751b8d5f43833e281811dd81f76bb`
- Owned implementation: `apps/cloud/**`, `apps/docs/**`, `internal/cloud/**`, this handoff, and the scoped iOS CI workflow.

Cloud and Docs are two independent products that share one audited storage service. They have independent package/bundle IDs, native/Web Wallet clients, callbacks, sessions, navigation, UI, screenshots, APKs, release records, and evidence.

Recovered evidence proves passing local core tests, real local Web rendering, and an Android Testnet Preview build/install/cold-launch/deep-link run. It does **not** prove completion of the full final objective: multipart/direct upload, product artifacts, portable export, capacity, production observability and remote durability remain incomplete. The authoritative booleans are in `apps/cloud/product-release.json` and remain false until direct requirement-wide evidence exists.

## Product identities

| Product/surface | Product | Client | Bundle/package | Callback |
| --- | --- | --- | --- | --- |
| Cloud native | `cloud` | `ynx-cloud-mobile-v1` | `com.ynxweb4.cloud` | `ynxcloud://wallet-auth/callback` |
| Cloud Web | `cloud` | `ynx-cloud-web-v1` | `web.ynx.cloud` | `https://cloud.staging.ynx.network/auth/callback` |
| Docs native | `docs` | `ynx-docs-mobile-v1` | `com.ynxweb4.docs` | `ynxdocs://wallet-auth/callback` |
| Docs Web | `docs` | `ynx-docs-web-v1` | `web.ynx.docs` | `https://docs.staging.ynx.network/auth/callback` |

Cloud requests sorted scopes `ai.use`, `audit.read`, `files.read`, `files.write`, `permissions.manage`. Docs requests `ai.use`, `audit.read`, `comments.write`, `documents.read`, `documents.write`, `sharing.manage`. The shared API maps these product-specific scopes and rejects cross-product reuse.

## Canonical Wallet and Gateway contract

There is no legacy assertion, query-field login, local fake session, persistent browser bearer, cross-product token, or verifier fallback.

The exact request/approval/challenge/completion envelope binds `ynx_6423-1`, product, client, bundle, callback, compressed P-256 device key, native account/public key, sorted scopes, nonce, purpose, request digest, issue and expiry. The Web client stores a non-extractable device key in IndexedDB and keeps the bearer only in memory. Native stores its device secret and session using `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.

Gateway completion signs `YNX_PRODUCT_SESSION_CHALLENGE_V1\n<canonical challenge JSON>` as P-256/SHA-256 canonical DER. The service persists and atomically consumes a one-time challenge. Replay, callback/client/bundle/device/account/scope mutation, expiry, invalid signature, unavailable verifier, or cross-App reuse fails closed.

Production calls authenticated `POST /v1/wallet-auth/sessions/verify`. The loopback-only `-dev-wallet` verifier exists for canonical tests and cannot bind a non-loopback listener. Exact native registry entries, the required Docs scope patch, Web multi-surface blocker, and failure vectors are in `apps/cloud/integration/`.

Central Wallet registry v3 currently permits one client/bundle/callback tuple per product and keeps Cloud/Docs disabled. It also has a stale Docs scope set. Therefore `integratedCentral` is false until central owners review the supplied patch, add reviewed Web registrations, enable the entries, deploy the verifier, and run real Wallet↔product staging flows.

## Cloud behavior

- Files/folders, recent, starred, search, trash/restore, upload/download/verified preview, immutable versions/restore, time-bounded grants/links, revoke, access request/decision, permissions, quota, audit, offline queue/sync/retry, collision-visible same-name creates, recovery, export/share, and exact-confirmation permanent delete.
- SHA-256 content addressing and verification on every content/version/share read. Size/quota/path/MIME/scanner/tamper/owner failures are closed before commit.
- Atomic metadata/audit persistence and verified `ynx-cloud-recovery/v1` backup/restore. See `apps/cloud/OBJECT_STORAGE_CONTRACT.md`.
- AI accepts only explicit selected file/version context and consent, exposes provider/model/status/resource estimate, supports cancel and review, and cannot share, delete, change permissions, or overwrite source content.

## Docs behavior

- Create/open/edit, version-aware autosave, immutable history/restore, version-bound comments/mentions, export, local draft, retry, stale-base 409, side-by-side recovery, bounded presence, audit, and exact-confirmation permanent delete.
- Every draft stores its base version. Conflict recovery keeps local text as a new document or adopts server content; no silent overwrite occurs.
- Presence is a 20-second expiring heartbeat explicitly described as not real-time collaboration.
- AI rewrite/summary/translate/outline/comment works only on the open exact version after consent; apply/reject is explicit and apply returns through normal version-aware save.

## Storage and recovery boundary

The current adapter is bounded local persistence, not production cloud storage. Blob names are digests, state is integrity protected and mode 0600, writes roll back on persistence error, and the service rejects missing/extra/tampered recovery files, traversal, symlinks, duplicates, non-regular files, size/hash mismatch, and restoring into an existing destination.

`apps/cloud/scripts/smoke.sh` completes canonical Cloud and Docs sessions; upload/download/hash; same-name collision; share/revoke; trash/delete; quota/audit; Docs v1→v2 autosave; stale conflict; comment; bounded presence; backup; restore; and byte-identical state comparison.

Production requires a reviewed adapter with multi-zone replication, durability SLO, owner-controlled KMS, malware scanning/quarantine, retention/object lock, transactional metadata, bounded retry/timeout, restore drills, metrics, and credential rotation. No such claim is made here.

## UI, accessibility, and internationalization

Cloud uses desktop sidebar/list/inspector and native semantic lists/sheets. Docs uses a document rail, compact toolbar, focused neutral writing canvas, and inspectors. There is no colored tile wall, template admin dashboard, fake letter mark, text-symbol icon, gradient, glass effect, Apple font, or copied Apple/Google asset.

Light/dark, system dynamic type, keyboard/focus, skip links, screen-reader roles/labels/live status, high contrast, reduced motion, 44 px touch targets, responsive Web, and native platform controls are implemented. Web/native support en, zh-CN, zh-TW, ja, ko, es, fr, de, pt, ru, ar, id; Arabic uses RTL and locale-aware dates. Detailed runtime screenshot review and fixed visual defects are in each `UI_DESIGN_AUDIT.md`.

## Verification completed

- `go test ./internal/cloud ./apps/cloud/cmd/ynx-cloudd`
- `go test -race ./internal/cloud`
- Cloud/Docs Web unit and static/a11y checks
- Cloud/Docs native TypeScript, Wallet tests, 12-locale/RTL/safety audits
- Canonical API smoke plus verified backup/restore round trip
- Android `assembleRelease` with JDK 17 / SDK 36, lint and dependency collection
- Android APK certificate, SHA-256, size, package, min SDK, install, cold launch, restart, and Wallet callback deep-link routing
- Real Web screenshots at desktop light/dark 1440×900 and responsive Arabic RTL 390×844; Docs v1→v2 autosave and Cloud authorized-folder success were exercised through the canonical local Wallet envelope.

Exact commands, images, hashes, and paths are indexed in each `apps/*/evidence/EVIDENCE_INDEX.md` and artifact manifest.

## Release blockers and next central actions

1. Merge/review `apps/cloud/integration/central-registry-json-patch.json`, adopt multi-surface Wallet registrations, enable Cloud/Docs, deploy the central verifier, then run real Wallet↔Cloud/Docs tests. Until then `integratedCentral=false`.
2. Provide two HTTPS Web staging hosts plus an authenticated API/object staging service, exact commit/version health, remote smoke, TLS, rollback, and durable secrets. Until then `deployedStaging=false`.
3. Provision production object storage/KMS/AV/backup SLOs before any production-cloud claim.
4. Run `.github/workflows/cloud-docs-ios-simulator.yml` or use a full-Xcode host for Simulator build/install/cold launch/deep link and artifact hash. Local `xcodebuild`/`simctl` are unavailable because the selected developer directory is Command Line Tools. Product-wide `installedLocal` remains false even though Android is installed.
5. Upload the committed Testnet Preview APKs to an immutable GitHub Release/object store and record URLs only after upload verification. Until then `downloadHosted=false`.
6. Owner-controlled production certificates and store accounts are external; `productionSigned=false` and `storeReleased=false`.

No merge/PR is created by this branch. Main control should cherry-pick/merge only after central protocol and deployment review.
