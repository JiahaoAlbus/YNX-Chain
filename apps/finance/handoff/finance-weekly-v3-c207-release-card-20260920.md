# Finance Weekly v3 c207 release and rollback card

Status: release candidate prepared and locally verified; public deployment not performed.

## Immutable candidate

- Product source: `c20709da38bc2a4823efb9870046b6afb7775992`
- Product tree: `8ff6ce4f3074eb6bcb64b2d5dc47dbd6b8ba48cb`
- Release tooling: `3c32c6133da7a758baa3551fbd1221c28445cc5c`
- Release: `finance-weekly-v3-c20709da38bc-linux-amd64`
- Archive: `apps/finance/evidence/release-candidates/finance-weekly-v3-c20709da38bc-linux-amd64.tar.gz`
- Bytes: `30251651`
- SHA-256: `839b1c97ac03471d13a7a036e6e0ea3b4054f2468140398a9e6cfda32c3f33a5`
- Sidecar SHA-256: `3246b6a45c58d29bbe8a130559ec7fdfc1e1ea469222ef0effe8ea1f479b5bfc`
- Verification evidence SHA-256: `20ccc53ab3e20c3705270c9e75da9ed05ba145ef57aae0f1f39894a8edcdc52f`

The archive has one top-level directory matching the release name, which is the layout consumed by `apps/finance/scripts/finance-production-rollback-first.sh`. It contains `ynx-finance`, `ynx-finance-admin`, `ynx-finance-broker-tools`, `ynx-finance-broker-worker`, exact Web files, `.env.example` and `manifest.json`.

Reproduce the archive from a clean owner checkout:

```sh
node apps/finance/scripts/build-finance-weekly-v3-candidate.mjs \
  --source c20709da38bc2a4823efb9870046b6afb7775992 \
  --output apps/finance/evidence/release-candidates/finance-weekly-v3-c20709da38bc-linux-amd64.tar.gz
```

The builder uses `CGO_ENABLED=0 GOOS=linux GOARCH=amd64`, `-trimpath`, `-buildvcs=false`, an empty Go build ID and the source commit time. It builds twice and fails unless both compressed archives are byte-identical. The exact four `go build` commands are embedded in the archive manifest.

## Safety and state compatibility

The packaged `.env.example` fixes `YNX_CHAIN_ENV=testnet`, `FINANCE_TRADING_ENV=sandbox`, `FINANCE_TRADING_ENABLED=false`, `FINANCE_LIVE_ENABLED=false` and `FINANCE_SANDBOX_WRITES_ENABLED=false`. It contains no credential or activation receipt. Local Linux execution reported `DISABLED`, `BLOCKED_CREDENTIALS`, `submissionEnabled=false`, `officialSandboxVerified=false` and `productionApproved=false`; it attempted no provider read or write.

The current public source `9912d29f82d5ceca689f07e20e944648a2be6de3` and candidate source both use Finance state version 2. The candidate adds a global uniqueness invariant but does not introduce a new on-disk version. It accepts a v1 file lazily; read-only startup does not rewrite that file. Tests cover v1-to-v2 migration, authenticated backup/verify/restore, tamper rejection, unsafe-path rejection and unsupported-state rejection.

For a file-backed deployment, take and verify an authenticated backup before the switch. Obtain `YNX_FINANCE_BACKUP_AUTH_KEY` only from the server secret manager; do not write it to the operation record:

```sh
ynx-finance-admin backup --state /var/lib/ynx/finance/state.json --output /approved/private/path/finance.backup
ynx-finance-admin verify --backup /approved/private/path/finance.backup
```

If state is PostgreSQL-backed, use a database-native consistent backup. The file admin deliberately refuses to back up a configured database through the bootstrap file path.

## Deployment

1. Obtain a fresh Central-signed Finance deployment lease. Re-read the current release link, service PID/restart count, environment/unit/drop-in/Caddy hashes, state backend and state identity. Do not reuse the 2026-09-19 baseline.
2. Put the exact archive and a candidate environment derived from the current environment into the lease carrier. Preserve all existing keys, update only the release Web path, and keep all trading/write/Live flags false. Do not add Alpaca credentials during this release.
3. Keep Finance drained from user writes during the switch and immediate verification. Use `apps/finance/scripts/finance-production-rollback-first.sh deploy <fresh-signed-lease>`; do not use the hard-coded 2026-09-19 deployment script.
4. Require the new `/version` to return `c20709da38bc2a4823efb9870046b6afb7775992`; require `/health`, `/ready`, `/api/broker/status`, `/`, `/app.js` and `/wallet-auth.js` to return the candidate-bound bytes. Require the service restart count, unit, drop-in and Caddy hashes to remain unchanged.
5. Confirm Broker status still has writes, official verification and production approval false before reopening traffic. Record the release link, runtime binary hashes, endpoint receipts and rollback target.

## Rollback

During the drained deployment window, any failed invariant must use the rollback-first executor's automatic restore of the previous release link and environment, then verify the old source and public bytes before traffic resumes.

After traffic is reopened, do not restore a pre-deployment state snapshot as a routine binary rollback because that could discard accepted Finance writes. The current public rollback target and this candidate share state version 2, so a later rollback should drain writes, back up the current state, atomically restore the previous release link and environment, restart, and verify the old source while preserving the current state. Use `ynx-finance-admin restore` only for an explicitly approved state-recovery event with the exact confirmation `RESTORE FINANCE STATE`.

The candidate archive and evidence stay retained after either outcome. No cleanup command may delete the previous release, backup or current candidate until the final public receipt and rollback window are closed.
