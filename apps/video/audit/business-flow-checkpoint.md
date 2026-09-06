# Video business flow checkpoint — 2026-09-06

Scope now extends from the completed Viewer/API recovery to real authenticated channel creation, upload, processing, review, publication and anonymous playback. The coordinator permits a separate, clearly labeled Testnet QA account and repository-owned test media. No personal Wallet, authentication bypass, direct database edit or fabricated view count is permitted.

## Verified deployed identities

- Viewer: `d75ad97040041b6febbf4e9ebdb338fdb4c1eff5`, recovered publicly.
- Video API: `1883d406f77f94cb81171b79fe9518882ede0b16`, absolute binary and restart repaired separately.
- Creator: manifest source `0e1a53c5ad1fc9dc2cbfebc13c55f1f426c7e7ae`, app.js SHA-256 `77e7c42006e3be36c7af717e5e8b2a3cd847c3652dcadb1731c259aee5b01af5`, current UI at `https://web4.ynxweb4.com/video/studio/`.
- Wallet Auth public `/version`: `6cf3ef845202bd879ed94515a71b323dd2fc9e14`, release `p0-v2-state-isolated-6cf3ef84`. It retains both canonical v1 and Product Session v2 routing.

## Exact contract mismatches

1. Current Creator sends `X-YNX-App-Session` from sessionStorage/hash. Video API `CentralProductSessionAuth` requires `X-YNX-Product-Session-Proof` and asks canonical v1 introspection. Merely connecting an injected Wallet never creates this proof.
2. The API introspection request has no `Origin`. The currently deployed canonical gateway requires the signed HTTP origin binding, so valid authentication cannot be assumed after changing only the header.
3. The retained v1 registry `/etc/ynx/wallet/central-registry-ae156b31.json` lists Creator and Video as `enabled:false`, `pending-review`, with empty `webOrigins`. Its Creator scopes use `creator:*`; API expects `video.creator` and related dot-separated scopes.
4. The v2 registry `/etc/ynx/wallet/product-session-registry-6cf3ef84.json` binds Creator to `https://creator.ynxweb4.com` and `creator:account`, `creator:publish`, `creator:revenue`; actual UI uses the `web4.ynxweb4.com/video/studio/` route. Product Session v2 has a separate proof header, paths, product fields and scope vocabulary; it cannot be relabeled as the API's existing v1 proof.
5. CUA tab `694444701` confirmed Creator still exposes internal proof-action controls and starts with empty locale selectors / unavailable private state. No connection or personal Wallet approval was requested.

Evidence: `business-runtime-inventory.json`, `creator-runtime-app.js`, `auth-unit-mapping.txt`, `auth-registry-paths.txt`, `auth-video-registrations.json`.

The coordinator has requested the current Wallet/Auth authority from its owner. No Auth source or registry was changed. `internal/video` and `apps/creator-studio` are absent from the current thin Viewer branch; consumer/API/UI repairs require an accurate source baseline and explicit ownership for those namespaces, rather than editing another owner's worktree.

## Intended real acceptance sequence

Use a separately generated QA account/device pair, keep private keys out of output and persisted evidence, and obtain a real signed Wallet authorization and device-bound Product Session through the actual deployed gateway. Confirm the exact product origin/callback and scopes. Then use the supported APIs:

1. `POST /v1/channels` for a clearly named Testnet QA channel.
2. `POST /v1/uploads` with the repository-owned clip and accurate rights metadata, fresh idempotency key and valid per-request proof.
3. Observe actual scanner/FFmpeg processing results and persisted media integrity fields.
4. Submit and review publication through existing authorized roles; do not assign or bypass moderator privileges locally.
5. Publish with explicit public visibility, then read the anonymous catalog and actual media URL.
6. Open the real public Viewer with CUA, play the video, observe progressing playback and record the source/runtime/media identity. Report the synthetic clip as Testnet test input, never as user content or business traction.

The current public catalog remains empty. No upload, publication or playback success has been recorded.

## 2026-09-06T04:35Z consumer candidate checkpoint

- Public DNS now resolves creator.ynxweb4.com and video.ynxweb4.com to 43.153.202.237. Normal ACME certificates validate. Both root pages, app.js and same-origin API health/catalog return 200 from independent server-side public DNS/HTTPS probes. Existing web4 routes and three application PIDs remained unchanged during Caddy route installation. Receipts: product-domain-*.txt. This proves routing only.
- Creator now uses the authoritative browser SDK from b3e4b5269d665ee5c8e2542454191cfc6ff53ecb, reproducibly bundled with esbuild 0.28.1. Browser device storage is webcrypto-nonextractable, not OS or hardware protection. The public Auth owner reports runtime f2939095023391a39b3ab0ee1528288110d01059. Product Session sign-in is distinct from EVM wallet tools; callback is an external script compatible with CSP; API retries create a fresh device proof. No legacy gateway_session is accepted as a v2 approval.
- Added explicit channel-invitation acceptance, same-origin backend proxy, upload-to-rights guidance and 390px layout. CUA Chrome local candidate loaded without product-origin errors; existing MetaMask extension warnings were present. Screenshots are in audit/ui. Local same-origin /video/api/health reached the actual current 1883 API through the existing SSH tunnel. Local origin deliberately cannot issue registered production sessions.
- Fixed API direct Publish bypass: public/unlisted first publication requires independent review; metadata edits withdraw the publication and invalidate prior review. Private visibility changes no longer produce a false reviewed/publication audit. Complete internal/video tests passed, including updated business fixtures using actual team invite/accept/submit/review methods.
- The opt-in Testnet QA script uses two dedicated identities, the repository-owned blue test clip, a source-bound rights declaration and actual independent review. Identity custody is restricted to an explicit ignored 0600 .qa-private file; it never prints keys, sessions or proofs. It can resume a known QA channel/video instead of duplicating writes. It has only passed offline checks so far.
- Consumer candidates are not yet deployed. Public catalog remains empty; installed Wallet approval, Creator public callback binding, upload/processing/review/publish and browser playback are NOT accepted yet. Video's private-library v2 UI and callback remain unfinished.
