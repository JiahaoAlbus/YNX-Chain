# Finance Weekly v3 c207 public release and rollback card

Status: deployed to `https://finance.ynxweb4.com` through one Central-signed rollback-first release. Public source, binary, static assets, disabled Broker status and browser surface were read back from the deployed runtime.

## Immutable release

- Product source: `c20709da38bc2a4823efb9870046b6afb7775992`
- Product tree: `8ff6ce4f3074eb6bcb64b2d5dc47dbd6b8ba48cb`
- Release: `finance-weekly-v3-c20709da38bc-linux-amd64`
- Archive: `apps/finance/evidence/release-candidates/finance-weekly-v3-c20709da38bc-linux-amd64.tar.gz`
- Archive bytes: `30251658`
- Archive SHA-256: `25db6bd6effac994e0de0a6c713d271aee14783000e74a0e79108019fd51b6ac`
- Manifest SHA-256: `1fc9bb5918a739d9e35694af87ca75ce525a67c90f9bef2a4a6c0a9444201cfa`
- Repack verification SHA-256: `faf4c4a48ddcc8ae341452751ab5bbbcf54a69dc221263f81c7d0ba84c2fd6f1`
- Runtime binary bytes/SHA-256: `20443284` / `53ddb7c982b7d7b0f3ecbb1d9540709fdf26ab3ac8a67138d93914fe8a44227b`
- Production executor bytes/SHA-256: `27946` / `bf87ba108eae755a9edd984775e332292254b0543aee7e9951e2d92752e75d10`

The archive includes explicit `0755` release and Web directory entries. The release verifier checks their extracted modes before the service can be switched. This fixes the fail-closed first attempt, where root extraction under `umask 0077` synthesized inaccessible directories and stopped at `SERVICE_USER_ACCESS` without changing the active runtime.

Reproduce the deterministic archive from a clean owner checkout:

```sh
node apps/finance/scripts/build-finance-weekly-v3-candidate.mjs \
  --source c20709da38bc2a4823efb9870046b6afb7775992 \
  --output apps/finance/evidence/release-candidates/finance-weekly-v3-c20709da38bc-linux-amd64.tar.gz
```

The builder uses `CGO_ENABLED=0 GOOS=linux GOARCH=amd64`, `-trimpath`, `-buildvcs=false`, an empty Go build ID and the source commit time. It builds twice and fails unless both compressed archives are byte-identical.

## Public runtime

- Current target: `/opt/ynx/releases/finance/finance-combined-c20709da38bc-20260920t032800z/finance-weekly-v3-c20709da38bc-linux-amd64`
- Environment SHA-256: `c21172537ead5102845efdff9c654d7d62b877eb49bd0e97ac1bf96c3b42373a`
- Service: `ynx-finance.service`, active, post-switch PID `1990765`, `NRestarts=0`
- State file: absent before and after the deployment; no migration, import, clearing or restoration ran
- Unit SHA-256: `2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b`
- Caddy SHA-256: `c9f18ca97f865efce1472b6fd99df5875cad9bba057c8f35abddedfa3f7c54c9`

`/health`, `/version`, `/ready`, `/api/broker/status`, `/`, `/app.js`, `/wallet-auth.js`, `/read-sources.js`, `/styles.css`, `/manifest.webmanifest` and `/ynx-logo.png` returned HTTP 200 and candidate-bound bytes. `/version` and `/health` report source `c20709da38bc2a4823efb9870046b6afb7775992`.

The deployed environment remains `testnet` plus `sandbox`; `FINANCE_TRADING_ENABLED`, `FINANCE_LIVE_ENABLED` and `FINANCE_SANDBOX_WRITES_ENABLED` are all `false`. Broker status is `DISABLED` with `BLOCKED_CREDENTIALS`; submission, official Sandbox verification and production approval are all false. No Alpaca credential or activation receipt was installed, and no provider read or write was attempted.

Visible Chrome regression showed the Chinese Finance guest surface, reachable YNX Testnet status, disconnected Wallet controls, and the US-stock Sandbox disabled/unlinked state. No Wallet account request, form submission, provider request or transaction was made.

## Deployment receipts

- Carrier lease: `finance-combined-c20709da38bc-20260920t032800z`, signed SHA-256 `a0267da6a892a883dc780bd9faccd1dc1e23965fbc66579c12b092593452b6ff`
- Production lease: `finance-combined-c20709da38bc-20260920t033100z`, signed SHA-256 `44704bc098baef9080b513ee350982fde42d56e14a36c939d79929b0921191a1`
- Production stdout: 1,948 bytes, SHA-256 `648de24fe167d471ab20a60e60f25ccc14a3bedeeedc69a62b0b6e01dd93960c`
- Transport receipt: 204 bytes, SHA-256 `9794d31394b57e32b88782ae3fb03d3182fd6993ef13efb536ab9928d7c46615`; SSH and remote exit status were zero and the terminal receipt validated
- Release inventory SHA-256: `3360a7d4b60adf13724a1a344c6269352d13a544005089fd3aa4949c07a91b3b`
- Backup inventory SHA-256: `11625192aebbe265539e9ba591a6ad8450c9eda43158e9ab786fede7e60e0c95`

Full immutable evidence is in `apps/finance/evidence/finance-weekly-v3-c20709da38bc-public-deployment-20260920.json`.

## Rollback

Retained rollback material:

- Backup: `/var/backups/ynx-finance/finance-combined-c20709da38bc-20260920t032800z/backup`
- Previous environment SHA-256: `0145270947f6bb5cd8fe95612b158e79d8246b75b802171228837e26769be7dd`
- Executor: `/opt/ynx/leases/finance/finance-combined-c20709da38bc-20260920t033100z.executor.sh`
- Signed lease: `/opt/ynx/leases/finance/finance-combined-c20709da38bc-20260920t033100z.json`

The recorded rollback invocation is:

```sh
/opt/ynx/leases/finance/finance-combined-c20709da38bc-20260920t033100z.executor.sh rollback /opt/ynx/leases/finance/finance-combined-c20709da38bc-20260920t033100z.json
```

This command is evidence, not current authority. A manual rollback requires a fresh Central-signed rollback lease and fresh production baseline. Drain writes first and preserve current state; do not restore an older state snapshot as routine binary rollback because that could discard accepted Finance writes.
