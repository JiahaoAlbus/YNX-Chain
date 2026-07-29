# YNX Music decision log

## 2026-07-29 — Persisted schema v2

Adopted schema v2 with a registry keyed by source schema version. Schema v1 is verified before migration, migrations must advance exactly one version, and unknown future schemas fail closed. This avoids opportunistic decoding and preserves rollback evidence.

## 2026-07-29 — Backup publication boundary

A backup is published only after verified state and referenced media are copied into a private temporary directory, hashed, manifested and atomically renamed. Existing backup destinations are never overwritten.

## 2026-07-29 — Restore publication boundary

Restore accepts only absent `state.json` and `media/` destinations. It verifies manifest fields, state digest/integrity, audit chain, canonical media inventory, file modes and media hashes before renaming restored objects into place.

## 2026-07-29 — Evidence classification

GitHub run `30417406111` proves Service, Android build and iOS Simulator execution for source `22653153c62529f782f44b0a35177b531ae7e8af`. It does not prove central integration, public runtime, physical-device Android, production signing, immutable downloads or store release.

## 2026-07-29 — Artifact inventory timeout

Two bounded GitHub artifact API attempts failed with TLS handshake timeout. The failure is recorded as execution evidence retrieval, not as product failure. The older local `ARTIFACT_MANIFEST.json` remains tied to its historical source commit and was not relabeled as current.

## 2026-07-29 — Domain ownership

`ynxweb4.com` remains the sole YNX product domain. No `huangjeo.com` product-domain misuse was found under `apps/music`; valid MCP subdomains are outside this product surface.
