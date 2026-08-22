# Video deployable runtime handoff

This handoff replaces the executable blocker `VIDEO_DEPLOYABLE_SOURCE_BOUND_RUNTIME_OBJECT_UNFROZEN` without claiming a production deployment.

## Frozen source and carrier

- Branch: `codex/video-p0-wallet-router`
- Source: `12606124dad61f5cb8032e302087c2d00c040b4d`
- Tree: `b039e5e8e3afc239e833669a329e9423cf07be1f`
- Carrier: `/private/tmp/ynx-video-12606124-runtime-1.tar.gz`
- Bytes: `24469`
- SHA-256: `f799c17ecc14511940e14c4ea7b44a632f7e860580720f3f7633ec48c9995db5`
- A second independent build is byte-identical.
- Archive metadata is normalized to sorted entries, UTC epoch mtime, numeric owner/group `0/0`, stable modes and `gzip -n`.

The archive contains the complete static application, `server.mjs`, a source-bound file manifest, and the frozen topology. It runs using only the Node.js standard library and serves both `/` and `/video/`.

## Isolated topology

The only mutable runtime is the dedicated Viewer root `/opt/ynx-video-viewer-wallet`:

- Viewer: `127.0.0.1:6494`
- API: `127.0.0.1:6493`, immutable for this operation
- Creator: `127.0.0.1:6495`, immutable for this operation
- Dedicated unit: `ynx-video-viewer-wallet.service`
- Forbidden shared path: `/opt/ynx-video/current`

The executor refuses the shared Video root, creates a new immutable release, changes only the dedicated Viewer `current` link, restarts only the dedicated Viewer unit, and compares the API and Creator response digests before and after. A post-switch failure restores the exact prior Viewer target.

## Direct local evidence

`npm run check --prefix apps/video` passed `11/11`. This includes a real shell fixture that deploys and rolls back a candidate under an isolated filesystem root. It proves two Viewer-only restarts, exact prior-target restoration, unchanged API and Creator sentinels, and no shared-runtime access. `npm run smoke --prefix apps/video` also passed.

## Requested next action

Central should review `video-deployable-runtime-lease-request-20260823.json` and issue one nonreusable Video-only lease after the deploy owner freshly freezes the host, dedicated Viewer unit and rollback target, Caddy route, and 6493/6494/6495 process identities. No production write has occurred. Account access, signing and transactions remain prohibited.
