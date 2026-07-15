# YNX Music handoff

## Branch and implementation

- Branch: `codex/ecosystem-music`
- Implementation commit: `1bdfb1d2b8c1bd2eba2d15b21758e4df4e5ad13e`
- Final handoff commit: use the branch head reported to the integration task.
- Base: `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95`
- Owned paths changed: `apps/music/**`, `internal/music/**`, this handoff.
- No central Gateway policy, root Makefile, long-term goal, or acceptance-state
  document was changed.

## Delivered architecture

`apps/music/cmd/ynx-musicd` is a standalone Go binary with an embedded responsive
Web product. `internal/music` owns the authenticated HTTP API, persistent domain
service, tamper-evident atomic JSON state, private media files, rights records,
usage, revenue allocation, Pay intents, Trust cases and AI audit state.

The UI is a distinct Klein-blue/white Music product rather than a mixed App or a
competitor layout. It contains listener home, search, artist/album filtering,
track evidence detail, profile, library, favorites, playlists, persisted queue,
playback controls, position recovery, history, authorized download state,
explicit-content control, reporting and privacy. The creator desk contains
onboarding, bounded PCM WAV upload, optional PNG/JPEG artwork, metadata,
provenance, owned/licensed rights declaration, draft/publish/takedown/dispute,
real usage records, evidenced revenue allocation, Pay settlement intent and Trust
case evidence.

The media engine is the browser `HTMLAudioElement` over authenticated media bytes.
The backend also implements HTTP byte ranges. Position is saved periodically, on
pause, on completion and during unload recovery. Completion produces one usage
record only after at least 80% playback; its player session reference is
idempotent across retries and restart.

## Truth and security boundaries

- Sign in uses the existing YNX account plus device signature challenge. It is
  bound to chain `6423`, exact product origin, device and a five-minute challenge;
  the Music product never receives a Wallet private/recovery key.
- Session tokens are server-validated and stored only in browser session storage.
  Protected routes fail closed and share the existing App Gateway rate limiter.
- Upload accepts bounded PCM WAV only. Rights basis, territory, evidence and
  audio provenance are mandatory; artwork provenance is mandatory when present.
- Draft media remains owner-only. Explicit media is denied before bytes are
  served when the listener control is off.
- State writes are atomic, mode `0600`, SHA-256 integrity checked on restart, and
  accompanied by a hash-chained audit event.
- Usage is authenticated client-reported evidence, not independent audience or
  anti-fraud proof. No streams, listeners, charts, artists, labels, earnings,
  royalty rate, public catalog or production streaming claim is synthesized.
- Revenue allocation must cite completed usage IDs and an external source record.
  A settlement is only `requires_wallet_review`; it is not paid/final without an
  authoritative YNX Pay receipt.
- AI supports real-library playlist, owned metadata improvement, discovery,
  creator description and royalty-record explanation. Context is restricted to
  owned/favorite track IDs. Provider/model, estimate, permission, streaming,
  cancellation, result, apply/reject and audit are persisted. Provider absence is
  an honest error; no canned fallback is labeled AI. Provider keys stay server-side.
- CSP, content sniff prevention, referrer and browser permission policies are set.
  Keyboard focus, skip navigation, live status, labels, reduced motion, increased
  contrast and mobile safe layout are implemented and checked.

## Verification evidence

Passed:

```text
node --check apps/music/web/app.js
go test -race ./internal/music ./apps/music/...
go test ./internal/music ./apps/music/...
bash ./apps/music/scripts/smoke.sh
go vet ./internal/music ./apps/music/...
npm run hardhat:build
npm run contracts:selectors
go test ./...
make no-placeholder-check
make secret-scan
make env-check
git diff --check
```

Coverage includes rights/upload rejection, explicit access, signed-session
authorization, HTTP Range playback, persistence/restart, position recovery,
usage replay, creator authorization, allocation/settlement duplication boundary,
AI context authorization, real SSE Gateway streaming, cancel/status/review/apply,
state tamper rejection, security headers, semantic labels, focus and reduced
motion. Smoke cold-builds and starts the exact binary, checks truthful health and
embedded Web, then confirms unauthenticated APIs return `401`.

Local build evidence:

- `/tmp/ynx-musicd` SHA-256
  `6eaa46e5c0c154353b137683c3bc0c32822d2a9e39446b15e555df81a081c003`
- Desktop 1440x1000 screenshot:
  `/Users/huangjiahao/.codex/visualizations/2026/07/15/019f6629-5aa4-7c01-bb13-f52c90349c0d/music-desktop.png`
  SHA-256 `189b49f8f66b114dbd8c1bace2e8056f2017a9806e727f4a9e0056d6331c88dc`
- Responsive 500x900 screenshot:
  `/Users/huangjiahao/.codex/visualizations/2026/07/15/019f6629-5aa4-7c01-bb13-f52c90349c0d/music-mobile-500.png`
  SHA-256 `9a69cf580ec5deab87a7dbaf1eb9f3e14246954538ba09732b23136b45d1c412`

The first repository-wide Go run failed because the fresh worktree had no
Hardhat artifacts. After the documented Hardhat build plus selector metadata
generation, `go test ./...` passed. Playwright was not installed in the baseline;
the exact embedded Web was cold-launched and captured with installed headless
Chrome instead.

## External/incomplete boundaries

- No licensed public catalog, public deployment, production object storage/CDN,
  store-signed mobile/desktop package, independent rights audit, collecting
  society integration, production anti-fraud proof or production streaming SLO is
  claimed.
- Browser download state is real for the current device session; offline license
  expiry/DRM is intentionally not claimed.
- The temporary Music binding uses an exact reviewed HTTPS origin through the
  existing App Gateway challenge contract. It must not be advertised as an
  accepted Wallet integration until the Wallet-auth branch and central registry
  change are reviewed together.
- YNX AI Gateway and YNX Pay credentials/routes are operator inputs. Missing AI
  config fails visibly. Settlement remains an intent until Pay supplies a committed
  receipt callback.

## Exact integration requests

1. Register a least-privilege `ynx-music-v1` client/binding in the accepted Wallet
   auth registry with Music profile/library/playback/creator scopes; keep the
   product origin exact and preserve the account+device proof.
2. Issue a server-side Music AI Gateway key and accept only the five documented
   Music workflows. Do not expose the key to the Web bundle.
3. Add a reviewed YNX Pay route that turns `requires_wallet_review` intents into a
   Wallet-reviewed transaction and reports committed receipt evidence back to
   Music. Do not let intent creation mark settlement paid.
4. Add a Trust universal link/case adapter for rights evidence, takedown, report
   and dispute IDs while preserving creator/listener authorization.
5. Integration authority may add root build/deploy targets only after reviewing
   this branch; this task intentionally did not modify the root Makefile or central
   policy.
