# Card e95 testnet deployment checkpoint — 2026-09-25

Scope: YNX Testnet Card simulation only. This receipt does not prove an official provider Sandbox, real card, funding, payment, Wallet approval, or a production financial transaction.

## Frozen inputs and recovery

- Backend source: `e95fcf443228d0db97c139dfa5e8ad6fbb7aa675`; public candidate prerelease `card-testnet-candidate-e95fcf443`. `card-source.tar.gz`: 6,612,399 bytes, SHA-256 `f5a5b46582410045fc00b10b4f7f32444a8abad2e431473f4a551f14d7fe8bcf`.
- Backend installed at `/opt/ynx-card/releases/e95fcf443228d0db97c139dfa5e8ad6fbb7aa675-candidate/apps/card`; previous immutable release `/opt/ynx-card/releases/88378ba45917eb817dfed9847c0a9a21e4026ea8/apps/card` retained.
- Before switch, live SQLite online backup passed `PRAGMA quick_check=ok`: `/opt/ynx-card/backups/20260925-pre-e95/card.sqlite`, 20,480 bytes, SHA-256 `0869e86135844ebfa29e0e043640fb73b87a99fb5261c5fb10148e33af005246`. Root-only directory and 0600 database. Separately preserved root-only `runtime.env` (including the unchanged storage key) and original `ynx-cardd.service`; no credential values are in this receipt. Original Caddy include preserved in the same private directory, SHA-256 `63732c3910f9190c6f78e187033eb3083d7d8a801ac059cd1b087a029f0040f1`.
- Rollback: restore the exact pre-switch service unit and runtime env from the private backup, `systemctl daemon-reload`, restart only `ynx-cardd`, verify prior source/version and authenticated state. If incompatible state has been written, first preserve current SQLite/WAL/SHM, then use the private online backup with the retained key following `server/deployment/README.md`; do not copy a live database or reset balances. Caddy can be separately restored from the exact backup and reloaded after validation. Vercel prior Ready deployment: `dpl_8qCEhiAq8hgiTYf2hA2FXU57W122`.

## Runtime and public route evidence

- Target machine: Linux x86_64, Node `v22.23.1`. Candidate ran against a private copy of the backup on loopback `:13094`: `/version` gave exact e95 source, `configurationReady:true`, `productionRealPayments:false`; unauthenticated `/api/card/v1/state` returned 401. The isolated process was stopped before service switch.
- Direct `node server/main.ts` failed on a TypeScript parameter property under Node strip-only mode. The installed service therefore uses locked `node --import tsx server/main.ts`; its `ExecStartPre` passed, `ynx-cardd` is active, and loopback `:18740/version` gives e95. The initial immediate post-restart curl raced startup; a subsequent check passed.
- Public `https://api.ynxweb4.com/api/card/v1/version` gives e95. The only Caddy edit added `/api/card/v2` and `/api/card/v2/*` to the existing host-bound Card matcher, without stripping the prefix or altering other handles. `caddy validate` passed and reload completed; installed include SHA-256 `af2b51392568627a2d2bff4b790ad42c37dab1672adc5434da500964486dda7e`. Public v1 state and v2 provider overview without a proof return 401; `/wallet-gateway/health` remains 200.
- Static source envelope: `card-static-envelope.tar.gz`, 2,486,033 bytes, SHA-256 `56e60f0ed02739f89036b5963a26fd1e4c4f01293118751a126c23ad09b9d463`, built from e95 tree `aa0debcaf163bb4da91a20c9ed6b4cc6104e7fb3`. Vercel project `jiahaoalbus-projects/ynx-card-testnet-simulation`, production deployment `dpl_AgpeBaJUD2FR42WgFSU2JTsMPxyG` Ready and aliased to `https://card.ynxweb4.com/`. Its sole config follow-up changes the exact `/wallet-auth/callback` rewrite destination from `/index.html` to `/`; the first destination yielded 404 under this project's `cleanUrls`, while `/` now returns 200. Unknown `/foo-notfound` still returns 404, v1 version 200/e95, v2 unauthenticated overview 401, and runtime identity reports e95, Testnet chain 6423, simulation only.

## Remaining truth gates

- `runtimeFundingVerified=false`; real Wallet approval/callback, provider-issued test card, official Sandbox credentials, real YNXT top-up, and real payments remain **NOT_VERIFIED**.
- The 200 callback response proves routing to the SPA, not a completed Wallet callback. The 401 responses prove an unauthenticated rejection, not an authenticated owner-flow acceptance.
- The static artifact's identity remains source e95; the later Card `vercel.json` rewrite correction is a separately recorded deployment-config delta.
