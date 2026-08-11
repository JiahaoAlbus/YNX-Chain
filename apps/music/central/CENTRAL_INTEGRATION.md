# YNX Music central integration

Status in current source: `integratedCentral: true`; current-source public deployment: `false`.

Music uses two exact platform identities:

- Mobile: `ynx-music-v1` / `com.ynxweb4.music` / `ynxmusic://auth/callback`.
- Web: `ynx-music-web-v1` / `web.ynx.music` / `https://web4.ynxweb4.com/music/auth/callback`.

Both request the sorted scopes `music.creator`, `music.library`, `music.playback`, and `music.profile`. The reviewed registrations are present in the canonical central registry and Wallet review UI. The local v2 manifests remain in this directory as product-owned integration evidence.

## Current protocol

1. The product creates an exact Wallet authorization request with a non-exportable P-256 device key.
2. Wallet returns an approval bound to the exact product, client, bundle, callback, scopes, nonce and request digest.
3. The product creates and signs `YNX_PRODUCT_SESSION_CHALLENGE_V1`, then submits the exact request, approval and completion to `POST /v1/wallet/sessions/complete` through the Music service.
4. Every protected Music operation creates a fresh `YNX_PRODUCT_SESSION_HTTP_PROOF_V1` bound to `POST /v1/wallet/sessions/introspect` and canonical body `{\"requiredScopes\":[scope]}`.
5. Music derives the required scope from its route, forwards the proof to the central Gateway, and accepts only an active, unexpired Mobile or Web tuple with that scope.

The old product challenge endpoint, server bearer credential, `X-YNX-App-Session`, and `X-YNX-Product-Device-Key` request headers are not accepted. Replay, wrong device, wrong product, cross-platform bundle substitution, scope widening, expiry and revocation fail closed.

Published non-explicit Testnet media is a separate guest read boundary. Guest access cannot read private drafts, library, playback history, profile, creator records, AI context, Pay intents or Trust cases.
