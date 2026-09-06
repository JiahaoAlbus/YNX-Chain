# Video delivery checkpoint — 2026-09-06

Status: Viewer deployed and verified at 2026-09-06T03:32:50Z. Same-origin local access reaches the real API. The public catalog is empty, so guest playback and complete Video usability remain unaccepted. No account request, signature or transaction was performed.

## Current public delivery

- Runtime source: `d75ad97040041b6febbf4e9ebdb338fdb4c1eff5`.
- Carrier: `apps/video/audit/artifacts/ynx-video-d75ad9704-runtime.tar.gz`, 27,622 bytes, SHA-256 `25748a1764e985a8abcd64cac53e25ecbefb7fbc20027142da555ac38fa314f5`.
- All 17 manifest files individually verified on the remote host. New immutable release: `/opt/ynx-video-viewer-wallet/releases/ynx-video-d75ad97040041b6febbf4e9ebdb338fdb4c1eff5`.
- Existing `ynx-video-viewer.service` still owns 6494 with a single new override `/etc/systemd/system/ynx-video-viewer.service.d/20260906-audit.conf`; user/group `ynx:ynx`, original settings retained, API origin explicitly set to loopback 6493.
- Only Viewer restarted for this deployment. API PID 3108210 and Creator PID 2803386, start times, unit hashes, Caddy, shared-current target, API health/version and three Creator response digests were identical before and after. See `viewer-deployment-receipt.txt`.
- Viewer rollback: remove only this new override, daemon-reload, then restart only `ynx-video-viewer.service`. The old Viewer subtree remains intact.
- Fresh mapping: `/etc/caddy/ynx-chain.caddy` strips `/video/studio/* → 6495`, `/video/api/* → 6493`, `/video/* → 6494`. API source is `1883d406f77f94cb81171b79fe9518882ede0b16`. No Caddy or shared-current change was made.

## Real backend verification

Tunneling local 8423 to the real 6493 API was insufficient: the API allows CORS only from localhost ports 4173/4174, so the actual browser on 4878 still reported `Failed to fetch`. The repaired frontend defaults to same-origin `/video/api`; the Viewer streams this path to a configured loopback HTTP API. Queries, status and media Range headers are preserved; failed upstream returns 503. Arbitrary remote upstream origins are rejected. Existing public Caddy API routing remains unchanged.

`npm run check --prefix apps/video` passed **54/54 tests**, including proxy queries, partial media responses and unavailable upstream, plus the 12-language audit. These are code tests, not media playback proof.

CUA Chrome tab `694444699`, using actual source on port 4880 and the real 8423→6493 SSH tunnel, changed from unavailable to `No published videos yet` after Retry. A screenshot confirmed blue/white navigation and the readable empty state. Chrome's automatic translation changed some visible strings, so that mixed-language screenshot is not localization-parity evidence.

CUA separately opened `https://web4.ynxweb4.com/video/?audit=d75ad9704&lang=en` in tab `694444700`: the logo, 12 locale choices and navigation rendered; the old literal `empty` and blank locale selector disappeared. Public HTTPS readback from the primary host bound the manifest to `d75ad9704` and app.js to 20,342 bytes / SHA-256 `5d2c10fe5ff1f7916b0659cd22dd3ec0b19fac91b41122b179e3c4864ef8b016`. See `public-runtime-readback.json` for endpoint records and vantage.

The anonymous real catalog returns `[]` (3 bytes). No published media URL exists to play. The repository-owned processing clip and authenticated upload requirements are documented in `api-execstart-repair-plan.md`. No direct data-store edits or authentication bypass were used. Upload, processing/publishing, permissions, editing, private workflows, native installations and store releases remain unaccepted. The broader responsive and language-quality pass requested by the user remains separate from this bounded recovery.

## Earlier bounded repair checkpoint (historical)

The later API repair was separately authorized and completed at `2026-09-06T03:38:05Z`, after Viewer publication. It changed only the API ExecStart override to its existing absolute binary and restarted API once. PID `3108210 → 2109198`, with identical health/version/catalog and unchanged Viewer/Creator. See `api-execstart-repair-plan.md` and `api-restart-repair-receipt.txt`.

- Isolated worktree: `/Users/huangjiahao/Desktop/YNX Audit Worktrees/20260906-video`
- Branch: `codex/audit-video-usability-20260906`
- Starting source: `3f56f665db6408e707d58a767eaf77344f72c62f`; clean before this checkpoint. No applicable AGENTS.md found in this worktree or its inspected parent directories.
- Existing owner worktree `/Users/huangjiahao/.codex/worktrees/222f/YNX Chain` remains untouched, including its dirty files.
- The historical `const catalog` reassignment and origin-root i18n URL are already repaired in this baseline. The earlier `app.js:44 null.addEventListener` was not reproduced in a fresh local code test or the independently opened CUA tab.
- Current local source loads the viewer and the no-provider installation choices. With no backend on loopback 8423, the catalog truthfully reports unavailable; this is not guest playback acceptance.
- Concrete review findings to verify: saved Wallet restore performs discovery outside its try/catch and can reject startup when the provider is no longer installed; runtime packaging omits the newly referenced `assets/ynx-logo.svg`.
- Deployment topology from the retained product record: Viewer 6494, API 6493, Creator 6495. Dedicated Viewer root `/opt/ynx-video-viewer-wallet`; shared `/opt/ynx-video/current` is not a Viewer deployment target. Root coordinator owns any deployment decision.

## Final source and repairs

Runtime source: `16ecbf3c3da564bb2260cdae629633eff16e8ce5` (preceded by repair commit `39c295bfd4e5b69c9c0339fa9bd63e3a652d4ac4`). Later audit-only commits do not change this runtime identity.

1. Reproduced the baseline restore rejection by running the actual `restoreWalletFromSession` implementation with a retained account selection and a removed provider: `WALLET_NOT_INSTALLED` escaped startup. Optional restore now returns a disconnected result for absent, locked, changed-account, changed-chain or stalled providers, so guest initialization proceeds. Reads retain the provider method receiver and time out; they never request accounts or trigger approval, switching, signing or transactions. A different provider with the same display name is not silently selected.
2. Included `assets/ynx-logo.svg` in the source-bound runtime carrier. Added SVG/JSON MIME types and an image-specific CSP allowance for the product's existing data-URI Wallet icons and local media thumbnails. Script and connection restrictions remain in place.
3. Canonicalized `/video?lang=en` to `/video/?lang=en` with HTTP 308, keeping relative modules under the routed product path. Malformed percent-encoded paths return HTTP 400 without terminating the server.

The old `app.js:44 null.addEventListener` report was not reproduced on this baseline. The previous i18n repairs were preserved, not reported as new work.

## Verification

- `npm run check --prefix apps/video`: 52/52 tests passed, including five new read-only restore regression tests, real local HTTP routing/MIME checks, deterministic archive rebuilding, shell deployment/rollback fixtures and existing retained-evidence guards.
- The 12-language catalog audit passed with 22 matching keys and RTL checks.
- `git diff --check` passed before both source commits.
- All 17 embedded runtime files were independently extracted and matched against their byte counts and SHA-256 values in `runtime-manifest.json`.
- CUA Chrome tab `694444694`, created separately for this task: the repaired page opened and reloaded without a blank page; Retry remained actionable. Final source at `http://127.0.0.1:4878/video?lang=en` visibly redirected to `/video/?lang=en`, with the logo, English navigation and Connect Wallet entry intact. CUA captured no application error log entries. The absent local API was explicitly visible as `Video service unavailable` / `Failed to fetch`, so this is an unavailable-backend UI check, not a console-zero network claim or playback success. The connection button was not clicked in the user's provider-enabled Chrome profile.
- Earlier direct CUA inspection of the predecessor used a separate in-app browser; it was no longer available when final verification resumed. No root-owned browser tab was used.

## Release candidate

- Artifact: `apps/video/audit/artifacts/ynx-video-16ecbf3c3-runtime.tar.gz`
- SHA-256: `efc17a18e875d3eba0dce6eb2c705db5a89da1f18d2794ee600754687c1437bc`
- Size: 26,995 bytes; 17 manifest-bound runtime files.
- Entry point: `server.mjs`, Node standard library only. Runtime startup: `PORT=6494 node server.mjs` from the extracted `runtime/` directory.
- Class: unsigned Viewer runtime candidate. This is not a Windows/macOS installer, signed release, public deployment, or accepted backend bundle.
- Machine-readable receipt: `apps/video/audit/artifacts/artifact-verification.json`.

## Backend and deployment contract for the coordinator

The public browser requests `${location.origin}/video/api/v1/...` and `${location.origin}/video/api/media/...`. The Viewer server serves static files only. The existing reverse proxy must route `/video/api/*` to the Video API on its recorded port 6493 with the API prefix translation expected by that backend, before routing the Viewer `/video/*` to 6494. The Viewer build must not replace or restart the independent API/Creator services or alter `/opt/ynx-video/current`. Preserve Creator 6495. Verify the currently deployed backend path contract before changing proxy configuration.

On loopback the browser uses `http://127.0.0.1:8423`; the owned local Viewer test intentionally had no API there. The artifact does not supply a media store, ingestion/transcoding workers, published videos, Product Session authentication or the backend service. Private actions still require the canonical Product Session integration and must not be enabled by a local fallback.

The coordinator still needs exact public byte readback, real API/catalog and guest media playback, private lifecycle acceptance where available, and current-source Android/iOS/desktop builds and installations. No production signing, store release, payment, settlement or complete cross-product flow was tested here.
