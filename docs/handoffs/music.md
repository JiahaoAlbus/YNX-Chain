# YNX Music native rework handoff

## Scope and truth status

- Branch: `codex/ecosystem-music`; final commit is the branch head reported to integration.
- Ownership stayed inside `apps/music/**`, `internal/music/**`, and this handoff.
- No root Makefile, long-term objective, central acceptance state, or other product directory was changed.
- This is a review candidate. It is not centrally merged, deployed, store-signed, installed for users, published, or production-ready.
- Public builds contain no bundled audio. Tests may generate repository-owned PCM tones at runtime; no commercial catalog, artist, label, stream, listener, chart, earnings, royalty, or rights claim is fabricated.

## Native products

Android is a native Java app (`com.ynxweb4.music`) with a foreground `MediaPlayer`/`MediaSession` service, notification controls, wake lock, authenticated Range media, atomic local JSON, Android Keystore session encryption, P-256 product-device key, offline WAV verification, queue advance, five-second position recovery, search, catalog, track/artist/album detail, favorites, queue, playlists, history, download state, profile privacy/explicit settings, creator onboarding/upload/release, Trust rights disputes, Pay review deep links and an explainable/disableable AI proposal plus explicit apply/reject workflow.

iOS is a native SwiftUI project (`apps/music/ios/YNXMusic.xcodeproj`, bundle `com.ynxweb4.music`) using `AVPlayer`, playback `AVAudioSession`, `MPRemoteCommandCenter`, Keychain `WhenUnlockedThisDeviceOnly`, atomic Application Support state, authorized offline WAV validation, file-import creator onboarding/upload/release, search/detail/library/history/queue/favorites/playlist creation, privacy/explicit settings, Trust disputes, Pay review deep links, explainable/disableable AI with apply/reject, background audio and the same Wallet callback. The project parses on this host, but full Xcode/iOS Simulator SDK is absent; launch and signing evidence are therefore pending rather than claimed.

The existing responsive Web is retained only as a backend/operator surface. It is not the mobile deliverable.

## Exact central contracts

Wallet:

- Version `1`, chain `ynx_6423-1`, product client `ynx-music-v1`, bundle/package `com.ynxweb4.music`, callback `ynxmusic://auth/callback`.
- Product-device algorithm is `p256-sha256` with a canonical compressed P-256 key; scopes are sorted `music.creator`, `music.library`, `music.playback`, `music.profile`; lifetime is at most five minutes.
- Native apps open `ynxwallet://authorize?request=<base64url JSON>`. Music sends the opaque Wallet response plus expected nonce to `POST /api/auth/wallet-v1/session`.
- The backend does not mint or self-assert central sessions. It calls the exact operator-configured `YNX_MUSIC_WALLET_SESSION_URL`, and protected requests that are not legacy Web sessions are checked through `YNX_MUSIC_WALLET_VERIFY_URL`. Missing central configuration fails closed. A consumed Wallet response digest is persisted and replay returns `409`.

AI:

- Provider keys remain server-side. Only playlist, metadata, discovery, creator-description and royalty-explanation proposals are accepted.
- Context is restricted to authorized owned/favorite track IDs. Provider, model, selected context, estimate, state, streamed result and human apply/reject are audited. Mobile AI can be disabled and has a separately persisted output language. Unavailable Gateway produces an error; no fallback is presented as AI.

Pay:

- Music creates only `requires_wallet_review` intent state. The exact configured Pay endpoint receives asset `YNXT`, integer micros, recipient, product intent ID and a required idempotency key.
- Central response must remain `requires_wallet_review` and provide an `ynxpay://settlement/review` URI. Altering a request under an existing idempotency key is rejected. Music never marks it paid; `committedReceipt` remains empty until a later authoritative receipt contract is integrated.

Trust:

- Report/takedown/dispute submits `open_case`, scope `music.rights`, purpose, requested action, subject and provenance/evidence to the exact configured Trust action endpoint with a required idempotency key.
- Local audit state distinguishes an open local case from `submitted_to_trust`; replay with changed content is rejected. Missing Trust configuration is an honest `503` with the local case reference, not a fabricated central case.

The daemon receives these boundaries only through server-side environment variables: `YNX_MUSIC_WALLET_SESSION_URL`, `YNX_MUSIC_WALLET_VERIFY_URL`, `YNX_MUSIC_WALLET_GATEWAY_KEY`, `YNX_MUSIC_AI_GATEWAY_URL`, `YNX_MUSIC_AI_GATEWAY_KEY`, `YNX_MUSIC_PAY_GATEWAY_URL`, `YNX_MUSIC_PAY_GATEWAY_KEY`, `YNX_MUSIC_TRUST_GATEWAY_URL`, and `YNX_MUSIC_TRUST_GATEWAY_KEY`. Endpoint URLs are complete operator-reviewed routes; Music deliberately does not guess central URL paths.

## Persistence, rights and media

- Backend state is mode-`0600` atomic JSON with SHA-256 integrity and a hash-chained audit log; tampering fails restart/integrity checks.
- Upload accepts bounded PCM WAV and optional PNG/JPEG artwork. Owned/licensed basis, territories, evidence and audio provenance are mandatory; artwork provenance is mandatory when artwork exists. Draft media remains private and appears only in the creator's authenticated `creatorTracks` snapshot until explicit release.
- Native downloads are private app files, validated as RIFF/WAV and atomically replaced. There is no DRM or offline-license-expiry claim.
- Position is persisted every five seconds and on pause/release; native platform background controls operate the same player. Queue and current position survive process restart.
- Completed usage requires the existing threshold and idempotent player session reference. It is authenticated client evidence, not proof of a unique listener or independently verified audience.
- Revenue needs completed usage plus an external source record. No royalty rate is inferred.

## Internationalization and accessibility

One audited catalog supplies 12 locales: English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português, Русский, العربية and Bahasa Indonesia. Android resources are the source and `apps/music/shared/i18n.json` is bundled into iOS.

The app auto-detects system language, supports manual switching, persists the choice across restart, keeps AI output language independent, falls back to nonblank English keys, localizes number/date output, and forces Arabic RTL. The audit compares exact key sets, nonblank/layout bounds, Arabic script and minimum legal/payment/auth/privacy semantics. Native controls have visible labels/content descriptions and status uses an accessibility live region; iOS uses semantic SwiftUI controls and dynamic system typography.

## Verification evidence

Passed in this worktree:

```text
go test ./internal/music
go test ./internal/music ./apps/music/cmd/ynx-musicd
go test ./...
go vet ./internal/music ./apps/music/...
bash apps/music/scripts/smoke.sh
node apps/music/scripts/i18n-audit.mjs --write
node apps/music/scripts/i18n-audit.mjs
  12 locales x 55 keys; Arabic RTL enabled
swiftc -parse apps/music/ios/YNXMusic/YNXMusicApp.swift
plutil -lint apps/music/ios/YNXMusic/Info.plist
plutil -lint apps/music/ios/YNXMusic/YNXMusic.entitlements
plutil -lint apps/music/ios/YNXMusic.xcodeproj/project.pbxproj
```

Go coverage includes signed authorization, central Wallet unavailable/exchange/replay rejection, HTTP Range playback, rights, explicit filtering, private-draft creator visibility with public-catalog non-leakage, restart recovery, usage replay, allocation authorization, settlement duplication, AI context and provider streaming/review, state integrity and security headers. The full repository Go suite also passed.

Android build/install evidence is recorded below after the final verification run. The APK and generated build directories are gitignored and are not committed.

```text
JAVA_HOME=$(/usr/libexec/java_home -v 24) ANDROID_HOME=$HOME/Library/Android/sdk \
  gradle --offline --no-daemon -p apps/music/android \
  :app:assembleDebug :app:assembleDebugAndroidTest
BUILD SUCCESSFUL

app-debug.apk
sha256 c3770c443ed786bddafdff408e13a2d95a4275dc257e21bacfa04763cfa79b37

app-debug-androidTest.apk
sha256 7565234d94f94a0894e3a026801af0eadd584447c2e7c1f06b768db29bda0daf
```

API 36 device evidence passed after waiting for Android package services rather than treating `sys.boot_completed=1` alone as readiness:

```text
adb -s emulator-5562 install -r -t app-debug.apk
Success
adb -s emulator-5562 install -r -t app-debug-androidTest.apk
Success
adb -s emulator-5562 shell am instrument -w \
  com.ynxweb4.music.test/android.test.InstrumentationTestRunner
OK (2 tests), 3.341s

adb -s emulator-5554 shell am start -W -S \
  -n com.ynxweb4.music/.MainActivity
Status: ok; LaunchState: COLD; TotalTime: 4739 ms; PID 28211

adb -s 127.0.0.1:5555 shell am start -W -S \
  -n com.ynxweb4.music/.MainActivity
Status: ok; LaunchState: COLD; TotalTime: 3824 ms; PID 28481
```

The shared AVDs produced unrelated system ANR overlays (`Pixel Launcher`, `System UI`, `Digital Wellbeing`) that obstructed a clean UI Automator hierarchy capture. This does not invalidate the successful Music install/instrumentation/cold-start records, but screenshot/accessibility-dump evidence is not claimed.

Feasible desktop/operator artifact evidence (not a native Music desktop client and not production streaming):

```text
go build -trimpath -o /tmp/ynx-musicd-darwin-arm64 ./apps/music/cmd/ynx-musicd
sha256 4e83cc6ee6ec5b372bf7eaef4dee711106efaa00e1e67af97f1c80230411e800
GOOS=windows GOARCH=amd64 go build -trimpath \
  -o /tmp/ynx-musicd-windows-amd64.exe ./apps/music/cmd/ynx-musicd
sha256 d5ebfa41a5e63f957f3f41f4edd70695c0fb2a02aea9eee80d10352b599430c2
```

## Honest pending and external blockers

- Full Xcode is absent (`xcode-select` points to `/Library/Developer/CommandLineTools`; `xcodebuild -version` rejects it). iOS Simulator launch, archive, signing, TestFlight and App Store evidence are pending.
- Android APK install, runtime contract instrumentation and cold launch passed on API 36 AVDs. Clean screenshot/UI Automator evidence remains pending because shared AVD system processes generated blocking ANR overlays; physical-device and release-signing checks also remain external.
- Central Wallet client registry acceptance and real endpoint/key provisioning are external integration work. Until provided, the native login correctly reports unavailable.
- Pay committed-receipt ingestion is not defined by the accepted central contract yet. No settlement can become paid in this branch.
- No licensed public catalog, CDN/object storage, independent rights audit, collecting-society integration, production anti-fraud proof, Play signing, Play Store, TestFlight, App Store, public deployment or partner approval is claimed.
- There is no native desktop Music client. The embedded responsive operator surface and reproducible Darwin/Windows daemon builds are the only desktop-feasible evidence and must not be described as a Spotify-class desktop app.

## Integration requests

1. Review/register the exact Wallet client, package/bundle, callback and scopes; provision exact session exchange and introspection routes.
2. Provision least-privilege Music AI, Pay intent and Trust action server credentials and routes.
3. Define a signed, replay-safe Pay committed-receipt callback before allowing any `paid` state.
4. Run the iOS project on a host with full Xcode and an installed iOS 17+ Simulator; separately perform signing only with authorized certificates.
5. Integration authority may add central build/deploy wiring after reviewing this branch; this product branch intentionally did not change central files.
