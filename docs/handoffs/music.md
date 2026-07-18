# YNX Music 0.3.0 Testnet Preview handoff

## Truthful release state

| State | Value | Evidence |
|---|---:|---|
| implemented-local | true | Native Android/iOS, Go service, embedded Web and central patch |
| tested-local | true | Go unit/integration/race/tamper/replay/restart, contract, locale, Swift parse, Gradle/lint/instrumentation |
| installed-local | Android true; iOS false | API 36 APK install/cold/restart/deep-link; iOS requires committed macOS CI/full Xcode |
| integrated-central | false | Exact registry/operations delivered; central owner has not merged/deployed them |
| deployed-staging | true after release deployment record | `web4.ynxweb4.com/music/` path and exact build health |
| deployed-public | false | Staging is not a production Music release |
| download-hosted | false | Upload-ready artifacts exist locally; no immutable release URL |
| production-signed | false | Android preview uses SDK debug signing; release APK is unsigned; iOS unsigned |
| store-released | false | No Play/App Store submission or approval |

No bundled commercial music, real artist/listener/chart/income/royalty claim, public licensed catalog or production streaming is present.

## Product and canonical session

YNX Music is independent: product `ynx-music`, client `ynx-music-v1`, package/bundle `com.ynxweb4.music`, callback `ynxmusic://auth/callback`, chain `ynx_6423-1`, and sorted least-privilege scopes `music.creator`, `music.library`, `music.playback`, `music.profile`.

Android and iOS create a device-bound P-256 key, send the exact 13-field Wallet request, accept exactly one callback query item named `response`, bind the Wallet approval to the request, request a central Gateway challenge, sign `YNX_PRODUCT_SESSION_CHALLENGE_V1\n + canonicalJSON(challenge)` as P-256 DER, and submit request + approval + completion. Protected API/media calls carry only `X-YNX-App-Session` and `X-YNX-Product-Device-Key`; central introspection binds identity, key, scope, expiry and revocation. Exact completion replay and unknown fields are rejected. Legacy Music challenge routes, bearer tokens, local session minting, query-field auth and browser session storage are gone.

The authoritative Wallet/Auth v2 registry entry, endpoint shapes, merge checks and false-until-deployed status are in `apps/music/central/`. The branch deliberately does not claim central integration.

## Listener and creator workflows

Listener surfaces cover Home/Search, artist/album filtering and track evidence, Library, Favorites, private History, Queue, Playlists, Now Playing, Offline/Downloads and Profile/privacy/explicit settings. Android uses MediaPlayer + MediaSession foreground playback, notification/lock controls, Range authorization, queue advance and five-second restart position. iOS uses AVPlayer + AudioSession + RemoteCommandCenter, background audio, queue and atomic restart state.

Creator Studio is outside listener tabs. It supports onboarding, owned/licensed declaration, WAV/artwork upload, mandatory provenance/evidence/territories, private draft, release, takedown and Trust report/dispute/appeal with audit. Drafts are visible only to their owner and do not leak into catalog queries. Tests generate a repository-owned PCM tone at runtime and verify its WAV/hash boundary; the product distributes no test audio.

Revenue allocation requires completed authenticated usage plus an external source record. Pay creates only `requires_wallet_review`; without a future authoritative committed receipt nothing becomes paid or a royalty. AI supports playlist recommendation/organization, metadata, creator description, discovery and royalty explanation, with explicit context/permission/provider/model/estimate, stream/disconnect cancellation, apply/reject and audit. AI cannot publish, pay, delete, penalize or change permissions.

## Security and persistence

The daemon uses strict JSON decoding, bounded request/upload/response sizes, per-client rate limits, ownership and scope checks, replay/idempotency protection, atomic mode-0600 persistence, SHA-256 integrity and a hash-chained audit log. State tamper and wrong owner fail closed. Central provider keys remain server-only. Web is read-only without a native product session and stores no credentials.

## Platforms, evidence and artifacts

Android min SDK is 28 and target SDK 35. The Testnet Preview APK is debug-signed and installable; the release variant is intentionally unsigned. Clean cold launch, restart, tampered deep-link failure, Arabic RTL, large text, dark/light and instrumentation evidence is indexed in `apps/music/EVIDENCE_INDEX.md`.

This host lacks full Xcode (`xcode-select` is CommandLineTools). Swift parse and plist validation are local evidence only; `.github/workflows/music-platforms.yml` performs a real iOS Simulator build, install, cold launch, tampered deep link, screenshot, restart and artifact upload on macOS 15. Until that CI run is green, iOS `installedLocal` remains false.

The Darwin/Linux daemon artifacts are operator services, not native desktop music clients. Web desktop light/dark screenshots prove responsive staging behavior but do not upgrade desktop installation status.

## Ownership requests and blockers

1. Wallet/Auth owner: merge `apps/music/central/wallet-registry-v2.json`, implement the exact challenge/session/introspection operations, run canonical failure vectors and deploy. Only then set `integratedCentral=true`.
2. Owner-controlled release accounts: provide Android production keystore, Apple distribution identity/profiles and Play/App Store accounts if production signing/store release is desired.
3. Distribution owner: publish immutable artifacts and checksums to GitHub Release/object storage. Current GitHub CLI credentials are invalid, so `downloadHosted=false`.
4. Rights/business owner: provide licensed catalog/CDN/territory agreements and independent rights review before any public catalog or production streaming claim.
5. Pay owner: define and deploy a signed, replay-safe committed-receipt ingestion contract before any `paid` state exists.

Release metadata, exact hashes, staging health, rollback boundary and remaining limits are in `apps/music/product-release.json`, `apps/music/ARTIFACT_MANIFEST.json`, `apps/music/EVIDENCE_INDEX.md`, `apps/music/RELEASE_NOTES.md` and `apps/music/docs/OPERATIONS.md`.
