# YNX Finance Active Plan

## Current stage

FREEZE. Authenticated recovery is protected at `23bcdea565bcfcb7d211512e654f916faf817df3`; the fail-closed cross-product consumer boundary is protected at `592195a1a4c5bed434d984482a1e87202de213ce`. `codex/final-finance` tracks `origin/codex/final-finance`, and local/remote SHA equality has been verified. Central Wallet acceptance, owner source contracts, shared Testnet proof, staging, public deployment and production signing remain incomplete.

## Protected scope

- Explorer health/native-asset validation, bounded activity and explicit provenance.
- Account/snapshot-bound HMAC-SHA-256 activity cursors.
- Version-1 strict Finance state validation, authenticated backup and offline restore.
- Finance-owned `finance-source-read-envelope-v1` consumer proposal.
- `/api/sources` plus Web and native pending-source states for Exchange, DEX, Quant and Economics.
- Strict source/owner/network/asset/Wallet-account/owner-version/payload-schema/capability binding.
- Fail-closed wrong binding, unknown field, future/incomplete provenance, empty payload, unaccepted capability and mutation-disguise rejection.
- Optional HTTPS navigation only; action URLs cannot configure an adapter, grant authority or make a source available.
- Twelve localized native source-status strings, including Arabic on the existing RTL path.

## Verified gates for the protected source-contract commit

- `go test ./internal/finance ./apps/finance/cmd/server ./apps/finance/cmd/admin -count=1`
- `go test -race ./internal/finance ./apps/finance/cmd/server ./apps/finance/cmd/admin -count=1`
- `npm run smoke --prefix apps/finance` — 8/8 product/Web/Wallet vectors plus server/admin builds.
- `npm run typecheck --prefix apps/finance/mobile`
- `npm test --prefix apps/finance/mobile` — 6/6, including locale completeness and Arabic formatting.
- `bash scripts/validate/no-placeholder-check.sh`
- `bash scripts/validate/secret-scan.sh`

The first push of `592195a1a4c5bed434d984482a1e87202de213ce` returned a remote 502; the bounded retry succeeded and local SHA equals upstream. The full repository Go preflight remains failed outside Finance ownership because Consensus/IDE artifacts and Consensus/Faucet/Trust permission tests are not healthy on this host. Mobile bundle and dependency audit blockers remain unchanged.

## Next autonomous runtime slice

Implement request IDs, stable public error IDs, structured JSON access/error logs and bounded in-process metrics for API latency/status/source outcomes. Add `/metrics` or an equivalent authenticated/operational endpoint with explicit version and no user financial payloads. Cover request-ID propagation, error correlation, source availability counters and restart behavior without claiming central Monitor integration.

## Following priority

Create `SLO_CAPACITY_PLAN.md` and `UNIT_ECONOMICS.md`, run bounded local latency/concurrency/storage-growth measurements, then hand the exact metrics contract to Monitor/Data Fabric. Separately, each source owner must freeze one exact read payload contract before Finance adds a payload adapter; all four sources remain unavailable until then.
