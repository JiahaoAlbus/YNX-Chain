# Exchange production lineage recovery

Implementation `5ca669342a95f9f4397ee3a650d5c7d26f4f7d7a`, tree `75535ac5244b30e311e1550dd2d195d04a2c2408`, branch `codex/exchange-schema10-wallet-20260912`.

## Direct read-only production observation (2026-09-12)

The explicitly authorized strict-known-host SSH inspection made no remote writes, stops, starts, account requests or transactions. It established:

- Canonical public `https://exchange.ynxweb4.com` is Caddy proxy `127.0.0.1:18446`.
- `ynx-exchange.service`: loaded/active/running, PID `877065`, NRestarts `0`, user/group `ynx`, working directory `/opt/ynx/exchange`, executable `/usr/local/bin/ynx-exchanged`.
- Binary: 9,523,384 bytes, SHA-256 `41b9c4854b77b9fc2dd30e3c4471a4b25f54fac949e67a1abf2b908f48838293`.
- `/var/lib/ynx-exchange/state.json`: schema **10**, 249,623 bytes, SHA-256 `86d52d7c764030bebc1ae0a06ebbdc030f5a6a33bb4e91177beb9cd8fd364e5e`; observed counts only: 7 balances, 63 orders, 30 trades, 188 ledger entries, 1 deposit, 2 sessions, 133 audit rows. Account values, credentials and raw state were not output or downloaded.
- Env `/etc/ynx/exchange.env`: SHA-256 `409983db6acf881430e64f8a2a767ab6f63ac625f7c0e5413a41c02b88153bc0`, no database URL configured. Unit SHA-256 `7feb4a60f1b9c8e1fc2991fcad3212f0d99e0d30cbd4e96c495d818e672f4532`.
- Shared Caddy root SHA-256 `077fe80ea9aab24a32d64ba1fab3584e8aab10304e200e58d976d2c33edfb39f`; Exchange Caddy fragment SHA-256 `7eca0af0a9f13e0d8a4021063b29cc15234012efd4cef5a9bb1e9f804800c8fb`.
- Public `/api/version`: HTTP 200 JSON, 107 bytes, SHA-256 `584b37a88d7f129785bebcbbb5058e881a40cc132296b79f8d7ecf01db60486e`; exact source `443286487e057d78cb6b1a686d14bb37be8b3c23`.
- Public and loopback `/api/health`: HTTP 200 JSON, 215 bytes, SHA-256 `bcf22421b76c03b9da4fa401c56405b123a6f8b7eaa49d942391dfec25ee3ee8`.
- Public root: HTTP 200 HTML, 18,603 bytes, SHA-256 `64c5b7862099eb06a316fbc6d1c665e81355f427fa27b26584bbf586ac4eacde`. Bare `/health` and `/version` on this old SPA return HTML fallback, not API evidence.
- `ynx-quant-exchange.service` is a distinct running dependency, PID `2275763`, not this canonical Exchange service. It must not be stopped or repointed by Exchange deployment.

These are timestamped observations, not locks or permission to assume later file hashes unchanged. All must be rechecked before eventual deployment.

## Precise compatibility correction

The previously preserved `835a76a6` owner checkpoint / `222a18b9` runtime uses schema 1 and requires PostgreSQL. Deploying that binary over schema 10 cannot load existing state; starting a blank database instead would abandon orders/risk state. Its 3,869,044-byte archive is therefore **not eligible for this production target**, even though its isolated tests pass.

This new branch inherits `beb1473e96b4333fa5edb6a6929ddb5cb128e42c` (the existing Finance-suite lineage containing public `44328648`, plus preserved custody-boundary and mobile dependency fixes). No other worktree, branch or pending changes were overwritten. The schema-10 store, file-CAS/PostgreSQL repository, matching, conditional orders, perpetual engine, risk, Quant execution and Finance integration remain inherited. The existing single-host configuration remains usable and is not described as PostgreSQL/multi-instance.

The exact shared `internal/productsessionv2` dependency was inherited with `-x` from `0b3761f903ffd5dee6367e49c613cfd8752d7562`, separate commit `1b972986bc231f81bb415c8f30d23a7916a77aa1`. No shared file was modified.

The current change composes the accepted verifier into three private **read-only** routes: account, margin account, liability proof. It pins canonical Wallet/Auth and Exchange origin/registry/scopes. Unsupported v2 routes, all writes/streams/Quant routes and mixed v1/v2 proofs reject without falling back. Proofs are independently introspected before venue state reads; no local token/session/native action key is created. Fixed private failure codes do not affect guest order book or Standard Wallet. Existing legacy signed routes are preserved, not silently converted to device-proof execution.

Account source metadata is added at the HTTP boundary only. Domain snapshots, persisted integrity and backup comparisons are unchanged; the initial attempt to put observation timestamps on domain snapshots was caught by the existing backup/restore drill and corrected before commit.

## Executed local gates

- `go test -race -count=1 ./internal/exchangeproduct ./apps/exchange/server ./internal/productsessionv2`: PASS.
- `go vet` the same packages: PASS; `git diff --check`: PASS.
- New real HTTP fixture: 20 concurrent reads split across two isolated users, exact schema-10 file bytes unchanged, second service construction retains state/integrity, per-request authority calls and replay denial.
- Negative fixtures: cross-origin, duplicate/malformed/expired proof, mixed protocol, private outage/guest usability, every unsupported v2 route, no native/public-key assignment, no persisted private authority.
- Existing full matching/conditional/perpetual/risk/Finance/Quant/CAS/backup suite passed. No production state is used in these tests.

Adapter blob `e6389a22df7b6e9897f6d9fc6eb221e33d00316a`, SHA-256 `1c2f4170760b0be045a6da469a6715a4ed11a304eb73c3fa272c4e4cd2366e3a`.
Fixture blob `cb503f9328cc7596d0290a8fdb8b61e5e50e1736`, SHA-256 `56d4b8b049c43bfabb4342c92d1e1b6eef6346a07d78cb8ac190d734fa5be680`.

## Continue, do not deploy this intermediate checkpoint

Next: port the exact c97 Standard SDK and 9840 private browser adapter from the preserved `835a76a6` work onto the **existing advanced business page**, replacing the legacy Wallet adapter rather than the trading page. Preserve native action signature boundaries; callback is not permission to POST. Legacy plaintext device keys must remain untouched/quarantined. Rebuild a schema-10-compatible immutable runtime, test source-bound Linux candidate against an isolated fixture, then fresh-bind current state/single writer and rollback before replacing only the canonical Exchange service. Do not copy stale state over newer writes or repoint Quant's shared current link.

No new runtime was deployed by this checkpoint. `publicCurrentSource=false`, `installed=false`, `realWalletApproval=false`, `signing=false`, `orderSubmitted=false`, `chainTransaction=false`, `migratedV2=false`.
