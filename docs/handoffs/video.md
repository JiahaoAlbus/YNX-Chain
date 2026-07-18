# YNX Video and Creator Studio handoff

## Delivery identity and scope

- Branch: `codex/ecosystem-video`
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain Video`
- Implementation commit: `33eaf45a148f5bf6449ab42adfc3e4e03e2857b9`.
- Final evidence candidate: use the pushed branch HEAD reported by this product
  thread; the final commit adds release truth, handoff and exact evidence only.
- Changed ownership only: `apps/video/**`, `apps/creator-studio/**`,
  `internal/video/**`, `docs/handoffs/video.md`, and existing product evidence.
- No central state/acceptance file, long-term objective, root `Makefile`, Gateway
  registry/policy, deployment file, or other product directory was modified.

The branch is an isolated candidate. It is not claimed merged, centrally
registered, installed in a shared environment, deployed, publicly reachable,
production signed, TestFlight/App Store/Google Play submitted, or partnered.

## 2026-07-18 closure update

This update supersedes the older hashes and test dates below where they differ.
The product now has exact Wallet/Gateway request attestation v2, mandatory durable
idempotency for unsafe operations, verified backup/restore tooling, a loopback
owned-media ClamAV/FFmpeg/HLS smoke, remediated responsive/RTL Web evidence, an
installed API 36 Android debug APK lifecycle, and an unexecuted macOS Simulator CI
workflow for feasible iOS evidence. Exact proof is indexed in
`docs/handoffs/video-evidence/EVIDENCE_INDEX.md`.

Central registration, staging/public deployment, production media durability,
production signing, live AI/Trust/Pay actions and revenue remain false. The
release manifests deliberately encode those false fields and empty URL lists.

## Corrected product architecture

### Native YNX Video

`apps/video/android` is a native Java/Android application, not a WebView. It has
independent package `com.ynxweb4.video`, `ynxvideo://wallet-auth/callback` and
`ynxvideo://watch` entry points, a Klein-blue vector launcher icon, network-only
permissions, HTTPS-by-default policy with emulator-loopback exception, native
VideoView playback, reviewed-caption transcript display, search, subscriptions,
playlists, history, comments, reporting, loading, empty, offline, unavailable,
failure and retry states, TalkBack labels, and locale/AI-output-locale
persistence. It generates/persists an Android Keystore P-256 product-device key
and constructs the exact canonical Wallet v1 `request=<base64url JSON>` envelope.

`apps/video/ios` is a full SwiftUI/Xcode project with independent bundle
`com.ynxweb4.video`, `ynxvideo` callback/watch entry points, Keychain
`WhenUnlockedThisDeviceOnly` P-256 product-device persistence, canonical Wallet
v1 request creation, AVPlayer adaptive playback, search/library navigation,
native subscriptions/comments/reporting/reviewed-caption transcript display,
localized loading/empty/offline/unavailable/retry states and VoiceOver labels.
The source and project parse, but this host lacks full Xcode, Simulator and Apple
signing, so no iOS native build/archive/Simulator result is claimed. A release
AppIcon asset is also pending release-owner artwork review.

The existing responsive `apps/video` Web viewer remains a secondary browser
surface. Its legacy query-field Wallet link was removed. It now uses the same
canonical Wallet v1 request and accepts only a `gateway_session` result from the
central flow. It provides playback, approved captions, channels, subscriptions,
playlists, history, comments, reporting, and viewer-data deletion; it does not
replace either native project.

### Web-first Creator Studio

`apps/creator-studio` keeps a distinct operations information architecture. It
covers channel recovery, bounded MP4/WebM upload, explicit owned-or-authorized
declaration, persisted scanner/transcoder status, retry, title/description,
thumbnail, reviewed WebVTT captions, visibility, event-derived analytics,
reports/takedown notice/appeal, human-reviewed monetization eligibility,
authoritative revenue records, Wallet-confirmed Pay intent, revenue dispute,
and AI preparation/stream/cancel/retry/review/delete/audit. It uses the exact
Creator Studio Wallet client/bundle/sorted-scope request rather than the old
legacy deep link.

## Service, persistence and recovery

`internal/video` is the deployable product service:

- atomic mode-0600 JSON persistence protected by a required HMAC integrity key;
- SHA-256-linked, sequenced audit records verified on restart;
- an actual `ObjectStorage` boundary with bounded relative keys, traversal and
  absolute-path rejection, per-prefix usage, quota, cleanup, and local staging;
- scanner and processor interfaces, fail-closed scanner readiness, real FFmpeg
  HLS plus original fallback, processing state and explicit retry;
- upload size/type/content-signature checks and total original+derivative quota;
- restart conversion of interrupted scanning/transcoding/running AI jobs into
  explicit recoverable failure states;
- channel/search/playback authorization, captions, subscriptions, playlists,
  history, comments, rate limits, reports, reviewer-only takedown, appeal,
  monetization review, revenue/dispute, and privacy deletion;
- analytics reduced only from persisted watch/subscription/authoritative Pay
  records. Empty records remain zero/empty and are never filled with synthetic
  views, watch time, subscribers, revenue, copyright, recommendations or deals.

The repository media remains the only test media:
`internal/video/testdata/ynx-owned-test.mp4`, generated as a Klein-blue frame and
642 Hz tone. Its provenance and hash are in the adjacent README.

## Wallet and central Gateway contract

Reviewed source: `codex/ecosystem-wallet-auth` worktree at `51cf0da` and
`packages/wallet-auth` protocol v1.

The production daemon no longer accepts operator-created `token=account`
mappings. Central Gateway requests must attest all shared verifier v2 fields:
`wallet-auth-v1`, `ynx_6423-1`, `p256-sha256`, exact product/client/bundle/
callback, canonical YNX account, sorted exact scopes, device public key, session
binding, bounded expiry, request timestamp, nonce, method/URI and request-body
digest. The `YNX_VIDEO_GATEWAY_REQUEST_V2` HMAC attestation is checked
server-side; nonce consumption is persisted. Tests cover changed body/product/
bundle/callback/scope, stale or overlong session, cross-App use, exact replay,
changed replay and replay after restart.

Product registrations expected at central integration:

- `ynx-video-mobile-v1` / `com.ynxweb4.video` / viewer scopes;
- `ynx-video-web-v1` / `com.ynxweb4.video.web` / viewer scopes;
- `ynx-creator-studio-web-v1` /
  `com.ynxweb4.creator-studio.web` / creator, AI proposal and Pay-intent scopes.

Those entries are deliberately not written into central policy by this branch.
Until the integration controller registers them and routes the Gateway, sign-in
finishes as honest `unavailable`; a raw Wallet callback is never treated as a
product session.

## AI, Trust and Pay boundaries

Reviewed sources: `codex/ecosystem-ai` at `5d8ff21`,
`codex/ecosystem-trust-resource` at `ae210bf`, and `codex/ecosystem-pay` at
`fd5016b`.

- AI supports summary, chapters, captions, metadata, search assistance and
  moderation explanation only. The owner selects metadata/caption context and
  an independent output language, reviews estimated units, explicitly grants
  permission, can cancel/retry, then accepts or rejects a suggestion. Provider,
  model, output, partial/failure, decision and deletion are persisted/audited.
  Accepting a suggestion does not mutate metadata, captions, visibility,
  monetization or moderation. AI cannot publish, claim copyright, take down,
  punish, approve revenue or execute a Pay intent.
- Trust reports, takedown notice, explanations and creator appeals persist
  locally with human reviewer boundaries. The authoritative signed Trust API is
  `/trust/appeals`. This service does not use its own service signer to impersonate
  a creator. A central per-user delegated signer/session route is still required
  before a local appeal can be submitted as a Trust chain action; the local UI
  never reports it as chain-submitted.
- Pay now uses the accepted central `/pay/intents` and
  `/pay/invoices/{id}/settlement` paths. Revenue requires matching paid YNXT
  evidence across settlement/intent/invoice, payout address, amount,
  transaction hash, block height and audit hash. Receipts and usage IDs are
  single-allocation. Creator Pay records remain
  `awaiting_wallet_confirmation`; intent creation is never called a payout.

Provider/API tokens and integrity/attestation keys are required server-side
environment values only. Missing AI, Pay, Trust delegation, Wallet registry or
Gateway routes produce explicit unavailable states, never canned success.

## Audited internationalization

The shared native catalog has exact nonblank key parity for English, 简体中文,
繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português, Русский,
العربية and Bahasa Indonesia. Android/iOS choose the system locale, allow manual
selection, persist it across restart, independently persist AI output language,
and switch Arabic to RTL. Creator Studio has the same automatic/manual/AI locale
controls and localized primary operations navigation.

The automated audit checks 12-locale parity, nonblank fallback, Arabic script,
critical privacy/payment/Wallet/offline/error semantics, Android/iOS exact
Wallet bindings, RTL hooks, and date/number/currency/plural formatting paths.
Security, privacy, payment and Wallet-confirmation text is not translated as a
success claim. Full release linguistic/legal review remains required before
publication.

## Verification evidence

Passed in this worktree on 2026-07-18:

- `go test -race ./internal/video/...` — pass, including repository-owned MP4,
  real installed FFmpeg, HLS output, object bounds, state tamper, audit chain,
  Gateway replay/tamper/restart, authorization, privacy deletion, AI review and
  authoritative Pay matching.
- `go vet ./internal/video/...` — pass.
- `npm --prefix apps/video run check` — pass, including 12-locale audit and
  strict Wallet v1 browser client checks.
- `npm --prefix apps/video run smoke` — pass, including served Wallet module.
- `npm --prefix apps/creator-studio run check` — pass.
- `npm --prefix apps/creator-studio run smoke` — pass, including shared catalog.
- Android Java against SDK 36 `javac` — pass.
- Android native clean `:app:assembleDebug` — pass; final debug/test-signed APK is
  32,401 bytes, SHA-256
  `c8df63b4b19c0071548487034fe01c1804c78b65ffea18990affd27c7e2b61fe`.
  The APK is ignored by Git.
- `aapt2 dump badging` — independent package/version, SDK 26..36, launcher
  activity, icon and only INTERNET/ACCESS_NETWORK_STATE permissions confirmed.
- `xcrun swiftc -frontend -parse` — pass for both Swift sources.
- `plutil -lint` — pass for Info.plist and Xcode project.
- `make env-check && make no-placeholder-check && make secret-scan` — pass.
- `make static-check` — pass, including repository Go vet and script syntax.
- `git diff --check` — pass.
- `go test ./...` — Video and all other available packages pass, except the
  unchanged baseline `internal/bftgateway` and `internal/consensus` IDE tests,
  which require ignored/missing
  `artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json`.
  This branch did not generate or commit another product's contract artifact.

The final APK was installed on the shared `YNX_Proof_2` API 36 emulator.
PackageManager returned `Success`.
After package-data clear, log clear and force-stop, `am start -W -S` returned
`Status: ok`, `LaunchState: COLD`, resumed
`com.ynxweb4.video/.MainActivity`, and measured `TotalTime: 19661 ms` /
`WaitTime: 20762 ms`. The process remained live and the post-launch error log had
no matching `FATAL EXCEPTION`, `AndroidRuntime`, or package crash. Exact install,
launch, deep-link, restart, runtime, package, permission, hash and emulator
provenance are committed
under `docs/handoffs/video-evidence/android-final/`. This is debug/test-signed
emulator evidence only; it is not production signing, physical-device, Play or
independent evidence. The emulator was heavily loaded; an unrelated system ANR
overlay was observed and is not represented as product performance evidence.

The existing `docs/handoffs/video-evidence/viewer-*.png` and
`studio-desktop.png` are retained as Web visual evidence from the returned
candidate only; they are not presented as native or new localization evidence.

## External blockers and no-claims list

1. Central controller must register the three exact Wallet clients/callbacks/
   scopes and accept the Gateway attestation route; no central registry change
   is claimed here.
2. Central AI Gateway must accept the product POST-body streaming contract,
   approved model/provider/quota and video scopes. No live AI result is claimed.
3. Trust needs a per-user delegated creator appeal signer/session contract. No
   Trust chain appeal or automated moderation action is claimed.
4. Pay deployment credentials and a real committed testnet settlement are
   required for external revenue/payout evidence. No revenue or payout exists in
   repository state.
5. Android production signing, release-owner custody, physical-device coverage
   and store submission remain absent. The committed proof is an API 36
   debug/test-signed emulator install and cold start only; no Play submission is
   claimed.
6. Full Xcode, Simulator, CocoaPods/toolchain if required, Apple signing,
   reviewed AppIcon, device tests and archive are absent. No iOS build,
   Simulator run, TestFlight or App Store readiness is claimed.
7. Local ClamAV/FFmpeg processing and backup/restore code/tests now pass, but
   production durable/HA object storage, scheduled operator restore, worker
   isolation, TLS origins, monitoring, rollback and independent security/privacy/
   accessibility/legal/linguistic review remain integration and release work.
   This branch proves local interfaces and recovery behavior, not production
   operations.
