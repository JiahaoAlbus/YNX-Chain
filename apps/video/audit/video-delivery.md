# Video delivery checkpoint — 2026-09-06

Status: bounded source repair and runtime artifact complete; no deployment, account request, signature or transaction performed. Full Video product usability is not accepted.

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
