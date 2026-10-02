# YNX Music

YNX Music is an independent native-first listener and creator product for owned or licensed audio. The Testnet Preview starts with an empty private catalog and contains no commercial recordings, invented artists/listeners/charts/earnings, royalty claims or production streaming.

## Run

```bash
go run ./apps/music/cmd/ynx-musicd \
  -http 127.0.0.1:6436 \
  -data /absolute/private/path/ynx-music
```

The embedded Web is an operator/staging surface and intentionally stores no Wallet session. Android and iOS are the user products. Both use platform playback, private atomic state, offline WAV verification, queue/position recovery and the canonical device-bound Sign in with YNX Wallet flow.

## Server-only integrations

```text
YNX_MUSIC_WALLET_CHALLENGE_URL
YNX_MUSIC_WALLET_SESSION_URL
YNX_MUSIC_WALLET_VERIFY_URL
YNX_MUSIC_WALLET_GATEWAY_KEY
YNX_MUSIC_AI_GATEWAY_URL / YNX_MUSIC_AI_GATEWAY_KEY
YNX_MUSIC_PAY_GATEWAY_URL / YNX_MUSIC_PAY_GATEWAY_KEY
YNX_MUSIC_TRUST_GATEWAY_URL / YNX_MUSIC_TRUST_GATEWAY_KEY
```

Missing configuration fails closed; no local verifier, token, provider response, payment or Trust case is substituted. The exact Wallet registry and integration patch are in `central/`.

## Truth boundaries

- Upload requires bounded PCM WAV, owned/licensed basis, territories, evidence and audio provenance; optional artwork requires provenance.
- Drafts are private until explicit release.
- Offline files are app-private RIFF/WAV, not DRM or perpetual license claims.
- Completed usage is authenticated playback evidence, not a unique listener or audience claim.
- Revenue allocation requires completed usage plus an external source record; no royalty rate is inferred.
- Settlement remains `requires_wallet_review`; it is not paid without an authoritative committed receipt.
- AI uses selected owned/favorite records only and requires explicit apply/reject.

## Checks

See `docs/DEVELOPMENT.md`. Release status and evidence are in `product-release.json`, `ARTIFACT_MANIFEST.json`, `EVIDENCE_INDEX.md`, `UI_DESIGN_AUDIT.md` and `../../docs/handoffs/music.md`.
