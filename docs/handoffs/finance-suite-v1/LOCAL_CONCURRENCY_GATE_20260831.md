# Finance-suite local concurrency gate — 2026-08-31

This receipt records local race-detector coverage only. It is not evidence of
a multi-instance public runtime, Wallet approval, or a settled financial
operation.

## Commands and results

| Product scope | Command | Result |
| --- | --- | --- |
| Finance | `go test -race ./internal/finance ./apps/finance/cmd/admin` | pass |
| Exchange | `go test -race ./internal/exchangeproduct ./apps/exchange/server` | pass |

The Finance command covers the read-only aggregation and administrative
boundaries. The Exchange command covers the product matching/service boundary.
Both exited zero under Go's race detector on the owner worktrees.

## Extended reproducible rerun

The following local gates were rerun after the product candidate readback. They
remain local evidence only; Go cache hits, where reported, are not expanded
into a broader runtime claim.

| Product scope | Exact source / command | Result |
| --- | --- | --- |
| Finance | Local duplicate `aceef25cf55675f49e5728324807739f81547f0e`; `go test -race ./internal/finance ./apps/finance/cmd/admin` | pass |
| Exchange | `1b263be6ed29341046f78657f6587afa13f3b629`; `go test -race ./apps/exchange/server ./internal/exchangeproduct ./internal/api` | pass |
| Quant | `301b680ac8bec297108a75920b1c34354345b574`; `go test -race ./internal/quantlab ./apps/quant-lab/server` | pass (`apps/quant-lab/server` has no Go test files) |
| DEX | `e752a9cc190fcbd5e4bd7f3799dc9b2645a1154f`; `npm test && npm run test:e2e` | 33/33 unit tests; 7 Playwright tests passed and 1 skipped |

The DEX suite exercises browser reconnect and fail-closed gateway handling,
but it has not run two independently authenticated public Testnet users. The
Finance entry is deliberately separated because `aceef…` is the unpushed
duplicate correction; the independent authority is
`0a86cce012e01cbcb093254cd8933129be125e5e` and was not replaced or
promoted by this rerun.

## Boundary

This does **not** prove the required public multi-user result: that still
requires a PostgreSQL-backed source-bound Exchange runtime, two independent
Testnet users, restart/reconciliation evidence, and distinct product deployment
leases. It also does not authorize DEX swaps/LP actions, Finance mutations, or
Quant execution.
