# DEX a554 source-bound runtime candidate

This handoff freezes a local unsigned Linux amd64 candidate for the current DEX
source checkpoint `a55441fd43c61431228fdf71f93933640bedcf9d` (tree
`d0e4fdfc3ec5d726e51083e89671b54010853a39`). It supersedes neither the
historical c7 candidate nor any deployed release; it is an additional source
candidate for Central to review.

## Candidate identity

- Archive: `apps/dex/evidence/release-candidates/ynx-dex-a55441fd43c6-runtime.tar.gz`
  — 3,126,108 bytes, SHA-256
  `01cc477b317235eca690ac0dae1311bd1269fa92a6fa22bec3fc84096a4a543f`.
- Linux amd64 static executable: `ynx-dex-a55441fd43c6/ynx-dex-indexerd`
  — 6,942,904 bytes, SHA-256
  `4d2a41b6f9cb66bef550ae5b80130c2ffb521c643e8647b5807a26064e59b7c1`.
- Archive has 16 entries. Its in-archive `SHA256SUMS` verified every payload
  file, and `BUNDLE_MANIFEST.json` binds the exact source commit and tree.
- The executable was cross-compiled with `GOOS=linux`, `GOARCH=amd64`,
  `CGO_ENABLED=0`, `-trimpath`, and `-buildvcs=false`; build metadata is bound
  to release `ynx-dex-a55441fd43c6` and source timestamp
  `2026-08-31T18:00:18+08:00`.

## Verified locally

- `go test ./internal/dex ./cmd/ynx-dex-indexerd` passed.
- `npm test --prefix apps/dex` passed: 33 tests.
- Canonical authorize/provider-discovery verification and legacy-route
  quarantine verification both passed.
- The current Playwright contract passed: 7 checks passed and 1 desktop-only
  mobile-layout check was intentionally skipped. Its fixture was corrected in
  source commit `310b8f05ee3bd241b62fd0767db4501f6671f00c` to supply the
  current authoritative `/v1/native-snapshot` schema, rather than the retired
  `/dex/*` collection endpoints. It covers truthful snapshot rendering,
  fail-closed gateway errors, review-before-Wallet behavior, and mobile layout;
  it does not connect an account or execute a transaction.
- Direct macOS execution intentionally did **not** pass: macOS rejects the
  packaged Linux amd64 ELF with `exec format error`. This is an architecture
  boundary, not evidence of a running Testnet service. Linux runtime validation
  remains required.

## Release boundary

The public DEX still reports old source
`ac775de24176b293b5dbb5ab7114cf29428f8046`; it is not bound to this candidate.
An old public `executionAvailable` field is not accepted as evidence of a
product-owned approval, swap, liquidity operation, custody operation, or
Strategy Vault execution.

Before any deployment, Central must perform a fresh DEX-only host/runtime and
rollback preflight, freeze a new rollback-first executor with unique paths and
literal command bytes, and issue a new single-use lease. No SSH, deployment,
wallet approval, account request, swap, liquidity action, transaction, or
ComputerControl verification occurred here.
