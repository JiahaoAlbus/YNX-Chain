# YNX Video and Creator Studio handoff

## Intake

- Branch: `codex/ecosystem-video`
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain Video`
- Branch start: `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95` (`main` at thread start). This is newer than the objectives document's historical baseline `271197f`; no rebase was performed.
- Commit: review the pushed branch HEAD reported by the product thread.
- Owned paths changed: `apps/video/**`, `apps/creator-studio/**`, `internal/video/**`, `docs/handoffs/video.md`, and `docs/handoffs/video-evidence/**` only.

## Delivered architecture

`internal/video` is a deployable Go service with atomic JSON persistence and a
bounded private object directory. It implements channel creation, upload,
type/size/rights checks, account quota, malware scanner interface, real FFmpeg
HLS processing, processing state, restart recovery, visibility review, search,
authorized media delivery, subscriptions, playlists, history, comments,
captions, thumbnails, reports, moderator takedown, creator appeal, event-derived
analytics, derived monetization eligibility plus human review, verified Pay
revenue records, Wallet-confirmed payout intents, revenue disputes and audit
events. Strict JSON parsing, bearer product sessions, moderator separation,
per-account rate limits, object path containment and replay rejection for Pay
receipts are enforced.

`apps/video` is a responsive viewer with Wallet deep-link sign-in, discovery,
search, adaptive-HLS playback selection, subscriptions, playlists, history,
comments and reporting. It displays loading, empty and service-failure states and
never fills them with recommendations or counters.

`apps/creator-studio` uses a separate side-navigation operations structure. It
provides upload/rights declaration, processing and visibility review, captions,
real analytics, monetization eligibility, payout intent, revenue dispute and a
bounded AI workspace. AI prepares an auditable permission request, calls the
server-side Gateway only when configured, preserves provider failure, requires
review and cannot directly apply metadata or publish/take down/claim rights/
punish/enable monetization.

## Truth and security boundaries

- The included MP4 is repository-owned: a generated Klein-blue frame and 642 Hz
  tone. Its provenance and SHA-256 are in `internal/video/testdata/README.md`.
- No views, watch time, subscribers, revenue, recommendations, copyright,
  partnerships or public availability are seeded or claimed.
- Analytics are reductions over persisted watch/subscription/verified-receipt
  records. Zero records means zero or an explicit empty state.
- `YNX_VIDEO_SCANNER` is required; absent/unavailable scanning fails closed.
- Media never publishes after scan/transcode failure. Interrupted jobs become
  explicit retryable failures after restart.
- Wallet secrets never enter either browser product. The temporary daemon
  adapter consumes opaque product session tokens mapped to `ynx1...` principals.
- AI and Pay provider tokens are server-side environment values only. Missing
  integrations return honest unavailable errors.
- Takedown and monetization changes require an account listed in
  `YNX_VIDEO_MODERATORS`; creator appeals and revenue disputes remain persisted.

## Verification performed

- `go test ./internal/video/...` — PASS, including repository-owned MP4 through
  the installed FFmpeg binary to a real HLS playlist.
- `go vet ./internal/video/...` — PASS.
- `npm --prefix apps/video run check` — PASS.
- `npm --prefix apps/video run smoke` — PASS.
- `npm --prefix apps/creator-studio run check` — PASS.
- `npm --prefix apps/creator-studio run smoke` — PASS.
- `make env-check`, `make no-placeholder-check`, `make secret-scan` — PASS.
- Headless Google Chrome cold loads — PASS at 1440x1000 for both products and at
  a narrow 500x844 viewer width. Evidence files and hashes:
  - `video-evidence/viewer-desktop.png`: `2b77dab5e70256fced433e377a1d2f90bca39029c2f7d2fd0eeae3bebd0936f8`
  - `video-evidence/viewer-mobile.png`: `1b9f5d34dc4f1360eb28f925d4d20cf1a0c8bfbe5498ffc48eed7fa119a8129b`
  - `video-evidence/studio-desktop.png`: `c9d75d1765593ec11ee2e92188013e2baccd38458450d4309e7d1f20e268b004`
- `go test ./...` — NOT fully passing because the baseline lacks
  `artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json`.
  Failures are limited to existing `internal/bftgateway` and `internal/consensus`
  IDE artifact tests; `internal/video` passes in the same run.
- Playwright was not added as a new repository dependency. Browser evidence used
  the installed Chrome headless runtime directly.

## Required main-thread integration

1. Replace `StaticTokenAuth` with the reviewed `codex/ecosystem-wallet-auth`
   session verifier and register exact clients `ynx.video.web` and
   `ynx.creator-studio.web`, callbacks and least-privilege scopes.
2. Register the product-specific AI scope and reconcile the implemented
   `POST /v1/video/generate` adapter with the accepted central Gateway contract.
3. Reconcile `PayClient` receipt and payout-intent paths with the accepted Pay
   branch; committed receipt evidence must remain authoritative.
4. Add reviewed Gateway routes, production origins/TLS, durable volume/backup,
   ClamAV, FFmpeg, health monitoring and rollback. Current CORS is intentionally
   restricted to the two local product origins.
5. The main task may add central Makefile/check/deployment entries after review;
   this branch intentionally did not modify central integration authority files.

## External/incomplete claims

No public deployment, production object durability, production Wallet session,
provider-backed AI result, creator monetization approval, YNXT payout, public
catalog, app-store package, partnership or independent audit is claimed. Those
states require the integration and external evidence above; the product reports
their absence rather than simulating success.
