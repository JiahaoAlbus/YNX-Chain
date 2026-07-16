# YNX Music

YNX Music is a separate native-first listener and creator product. It starts with an empty,
private catalog: public builds contain no commercial recordings, invented artists,
listeners, charts, earnings, labels, or royalty rates.

## Run

```bash
go run ./apps/music/cmd/ynx-musicd \
  -http 127.0.0.1:6436 \
  -data /absolute/private/path/ynx-music
```

The embedded Web remains an operator/debug surface. The user products are the
native Android project in `android/` and native iOS project in `ios/`; both use
the platform media engine, background controls, secure storage and restart recovery.

Open `http://127.0.0.1:6436` only for backend/debug work. The default authorization binding is the exact
production candidate origin `https://music.ynxweb4.com`; override it with
`-origin` only for the exact reviewed deployment origin. The product uses the
existing YNX Wallet account/device challenge contract. No account or recovery
private key enters Music.

Optional AI integration is server-side only:

```bash
export YNX_MUSIC_AI_GATEWAY_URL=http://127.0.0.1:6430
export YNX_MUSIC_AI_GATEWAY_KEY='operator-supplied-secret'
export YNX_MUSIC_WALLET_SESSION_URL='operator-supplied exact central exchange endpoint'
export YNX_MUSIC_WALLET_VERIFY_URL='operator-supplied exact central introspection endpoint'
export YNX_MUSIC_WALLET_GATEWAY_KEY='operator-supplied server key'
export YNX_MUSIC_PAY_GATEWAY_URL='operator-supplied exact Pay intent endpoint'
export YNX_MUSIC_PAY_GATEWAY_KEY='operator-supplied server key'
export YNX_MUSIC_TRUST_GATEWAY_URL='operator-supplied exact Trust action endpoint'
export YNX_MUSIC_TRUST_GATEWAY_KEY='operator-supplied server key'
```

If either value is unavailable, the UI reports provider unavailability and does
not generate a local substitute. AI requests expose only the explicitly selected
track IDs from the authenticated user's owned/favorite library.

## Media and creator contract

- Upload accepts bounded PCM WAV plus optional verified PNG/JPEG artwork.
- Audio rights basis, territory, evidence reference, and provenance are required.
- Drafts are private to their owner until explicit publish approval.
- The HTML media engine loads authorized bytes and persists playback position.
- A completed usage record requires at least 80% playback and an idempotent player
  session reference.
- Revenue allocation references completed usage records and an external source
  record. No royalty rate is inferred.
- Settlement creates a `requires_wallet_review` YNX Pay intent. It is never marked
  paid without an authoritative committed Pay receipt. Pay and Trust require an
  idempotency key and reject replayed keys with altered content.

## Native builds

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 24) \
ANDROID_HOME="$HOME/Library/Android/sdk" \
gradle --offline --no-daemon -p apps/music/android \
  :app:assembleDebug :app:assembleDebugAndroidTest

open apps/music/ios/YNXMusic.xcodeproj
```

Android application ID and iOS bundle ID are both `com.ynxweb4.music`; the deep
link is `ynxmusic://auth/callback`. iOS requires full Xcode and an installed iOS
Simulator runtime. No production signing or store distribution is claimed.

## Checks

```bash
go test ./internal/music ./apps/music/...
bash ./apps/music/scripts/smoke.sh
node --check ./apps/music/web/app.js
node ./apps/music/scripts/i18n-audit.mjs
swiftc -parse ./apps/music/ios/YNXMusic/YNXMusicApp.swift
```
