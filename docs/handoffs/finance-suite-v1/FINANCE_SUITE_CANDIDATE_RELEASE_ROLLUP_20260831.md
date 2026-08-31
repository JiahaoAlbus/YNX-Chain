# Finance suite candidate-release rollup — 2026-08-31

This handoff is a source and artifact inventory for Central integration. It is
not a deployment receipt and does not change any Wallet, Product Session,
account, signature, order, swap, liquidity, custody, or strategy-execution
truth flag.

| Product | Source candidate | Immutable candidate | Git availability | Public binding |
| --- | --- | --- | --- | --- |
| Finance | `50892538dc237ef519d95c491f4b918a125a6c8e` runtime package referenced by the accepted source-build record; suite drift evidence at local `1a4e86a51d416bc0b28ce197f8cc6eae902f2c76` | Finance Linux amd64 archive SHA-256 `d35f2e155ae3802b07048dd6f045b63ba477adeb1b12bc381d6e170294290915` remains source-only | Local-only drift handoff; normal push transport timed out | Public Finance still binds old `3b2383f5…`; no candidate binding |
| DEX | `a55441fd43c61431228fdf71f93933640bedcf9d` / tree `d0e4fdfc3ec5d726e51083e89671b54010853a39` | `ynx-dex-a55441fd43c6-runtime.tar.gz`, 3,126,108 B, SHA-256 `01cc477b317235eca690ac0dae1311bd1269fa92a6fa22bec3fc84096a4a543f` | Local `ccd63d05b9eb63dd0e9882f4e39c0cab9e17e76d`; normal push timed out | Public API is old `ac775de…`; legacy `executionAvailable=true` is not execution evidence |
| Exchange | `2f1b0f8bc08e2abedcf27bf9c2af902e49da4618` / tree `86a7b8ac89e0665ddc696b554ab408af0249cae0` | `ynx-exchange-2f1b0f8bc08e-runtime.tar.gz`, 3,503,813 B, SHA-256 `34b2ed6464ac031391aedeb062261a931aa94c318c88285ab3a720b6bf641359` | Remote readable commit `b91a6b962dfb7fea9a96cd83161982cd61bd75b5` / tree `e01e6a788278618ee15fe2cb9070e29e881156b2` | Root, health and version are one HTML fallback; no source-bound API |
| Quant | `5863ddc6a02c0069628fe4d6e8f831f260303271` / tree `253c34afb4273b426319eb7dd8d5a96ce58a6720` | `ynx-quant-lab-5863ddc6a02c-linux-amd64-runtime.tar.gz`, 3,355,474 B, SHA-256 `33e92fe50b9877025c61d354bfd0e93b0d03622bbee14da4d4550407542bdbc7` | Local `7aeea017e27dd9c9614083205655a9aa49ce32ba`; normal push timed out | Public Quant is old `443286…` and reports simulated Testnet only |

## Integration contract

Each candidate needs its **own** fresh host/runtime preflight and single-use,
rollback-first deployment lease. A product lease must bind the candidate archive,
binary, service/static-root layout, current release, unit, environment, Caddy or
equivalent ingress, persistent-state policy, unique stage/backup/release paths,
and exact public response hashes. Do not combine products into one lease.

DEX requires the accepted Chain Core Strategy Vault v1.35 product-owned custody
acceptance before any Swap, approval, LP, vault or liquidity execution. Exchange
and Quant require a PostgreSQL-backed, source-bound runtime before making a
multi-user public claim. Finance remains non-custodial and read-only.

All candidates here remain unsigned local artifacts unless the Git availability
column says otherwise. None is a public deployment, signed installer, download,
or ComputerControl/Wallet lifecycle proof.
