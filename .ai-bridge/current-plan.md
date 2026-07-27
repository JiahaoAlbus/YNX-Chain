# YNX Finance Active Plan

## Current stage

FREEZE. The authenticated local backup/restore slice is protected at `23bcdea565bcfcb7d211512e654f916faf817df3`; `codex/final-finance` now tracks `origin/codex/final-finance`, and local/remote SHA equality was verified. Central source contracts, installed Wallet approval, staging, public deployment and production signing remain incomplete.

## Protected scope

- Explorer health/native-asset validation and explicit source provenance.
- Account/snapshot-bound HMAC-SHA-256 activity cursors.
- Version-1 strict Finance state validation and private atomic writes.
- HMAC-SHA-256 authenticated backup envelopes with bounded size and strict schema checks.
- Offline restore with pre-restore preservation, SHA-256/byte evidence, reopen verification and automatic rollback on post-write failure.
- Admin backup/verify/restore CLI, recovery runbook, migration compatibility policy and negative tests.
- Repository placeholder/sensitive-material gates now fail correctly when the primary scanner is unavailable.

## Verified gates for the protected commit

- `go test ./internal/finance ./apps/finance/cmd/server ./apps/finance/cmd/admin -count=1`
- `go test -race ./internal/finance ./apps/finance/cmd/server ./apps/finance/cmd/admin -count=1`
- `npm run smoke --prefix apps/finance`
- `npm test --prefix apps/finance/gateway`
- `npm test --prefix packages/wallet-auth`
- `bash scripts/validate/no-placeholder-check.sh`
- `bash scripts/validate/secret-scan.sh`
- Shell syntax checks for modified validation/smoke scripts.

The full repository Go preflight still fails outside Finance ownership because Consensus/IDE artifacts and key-permission tests in Consensus, Faucet and Trust are not healthy on this host. The current mobile check passed TypeScript and 6/6 tests but could not run the bundle step because the local Expo executable is absent. The latest dependency-audit retry returned an upstream 502; the previously recorded 1 high and 10 moderate advisories remain release blockers.

## Next autonomous runtime slice

Create versioned, fail-closed read adapter contracts and negative vectors for Exchange, DEX, Quant and Economics. Finance must expose truthful unavailable/source-status states and action deep links only; it must not implement execution, signing, custody, a second Quant Engine or fabricated source data. Prefer owner-frozen contracts when present, and record explicit dependency conflicts rather than maintaining competing long-term schemas.

## Following priority

Implement request/error IDs, structured metrics and source-specific SLO signals; then add bounded local capacity/storage measurements. Deployed restore drill, RTO/RPO, mobile reproducible bundle/audit, central Wallet integration and shared Testnet flows remain required before stage advancement.
