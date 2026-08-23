# Video dedicated Viewer bootstrap handoff

This package closes the predecessor/bootstrap design gap only. It does not deploy the Video candidate.

The current public `/video/` bytes were matched exactly to source `e5ce33550bbd8a4be09a55a6bb3dd73cd3cb8833`. A deterministic 13,323-byte predecessor runtime carrier was built twice with SHA-256 `6771deb82ccc62a9c14d62ed40e7bda961806ffe3c14681b9cf53ec27afef2df`. Its `index.html` SHA-256 is the current public value `5c6aa1b9207680ff40f77df6d063571f67beff40719d727acf5d2fa0c05b591a`.

Implementation `f1e8ed4cce6fcd4cad383addcefce8a14f420d59` adds a dedicated bootstrap executor and a byte-frozen `ynx-video-viewer-wallet.service` template. The executor accepts only `/opt/ynx-video-viewer-wallet` and `/etc/systemd/system/ynx-video-viewer-wallet.service` in production. It refuses the shared `/opt/ynx-video` tree. It never names the legacy `ynx-video-viewer.service` in a systemctl operation and never writes Caddy, API 6493 or Creator 6495 state.

The actual-shell test starts with both the dedicated root and unit absent. It bootstraps the predecessor, switches to a candidate using the existing deploy executor, rolls back to the predecessor and verifies the exact old `index.html` SHA. A separate injected unit-enable failure proves the root and unit return to exact absence. Shared-current, legacy-unit, API and Creator sentinels remain unchanged.

Central should review `video-dedicated-viewer-bootstrap-lease-request-20260823.json`. Before issuing a single-use Phase-bootstrap lease, it must prove the old service is already inactive and 6494 is free, bind the exact staged object SHAs, freeze the `ynx:ynx` and `/usr/bin/node` identities, and keep the shared root, legacy service, Caddy, 6493 and 6495 outside the writable set. The bootstrap lease must not authorize the product candidate deployment.
