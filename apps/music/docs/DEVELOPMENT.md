# YNX Music development

## Boundaries

- Product ID: `ynx-music`
- Wallet client: `ynx-music-v1`
- Android/iOS identity: `com.ynxweb4.music`
- Callback: `ynxmusic://auth/callback`
- Scopes: `music.creator`, `music.library`, `music.playback`, `music.profile`
- Chain: `ynx_6423-1`; product-device proof: compressed P-256 + SHA-256/ECDSA DER

The exact central registry patch and operation contract are in `../central/`. Do not reintroduce bearer sessions, local token minting, legacy challenge routes, query-field auth, or an embedded verifier fork.

## Run and test

```bash
go test ./internal/music ./apps/music/...
go test -race ./internal/music
bash apps/music/scripts/smoke.sh
node apps/music/scripts/central-contract-audit.mjs
node apps/music/scripts/i18n-audit.mjs
xcrun swiftc -parse apps/music/ios/YNXMusic/YNXMusicApp.swift

ANDROID_HOME=/absolute/sdk ANDROID_SDK_ROOT=/absolute/sdk \
  gradle --no-daemon -p apps/music/android \
  testDebugUnitTest assembleDebug assembleDebugAndroidTest assembleRelease
```

Full iOS Simulator build/install/cold/deep-link evidence runs in `.github/workflows/music-platforms.yml` because this Mac has Command Line Tools but not full Xcode. A syntax parse is not treated as installation evidence.

## Persistence and media

The daemon writes mode-0600 atomic JSON plus SHA-256 integrity and a hash-chained audit log. Runtime tests generate a deterministic repository-owned PCM tone; no audio fixture is distributed in the app. Draft bytes are authorization-gated and omitted from listener catalog results. Media supports HTTP Range. Native downloads validate RIFF/WAV and replace atomically.

All central credentials are server-only environment variables. Unknown JSON fields, oversized bodies, missing scopes, ownership mismatch, tampered persistence, replay and changed idempotency bodies fail closed.
