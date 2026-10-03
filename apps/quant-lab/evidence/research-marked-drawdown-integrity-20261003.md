# Quant research marked-equity drawdown — 2026-10-03

Ordinary Quant research engine/test correction only. Shared Wallet authority,
permissions, formal graph pins, Host and public/native releases are unchanged.

## Actual failure

The existing simulation updated its equity peak and maximum drawdown only
after a fill. It still recorded held-position equity on every retained bar,
so its reported risk disagreed with its own curve and published definition.

Before correction, real `simulateDetailed` fixture regressions failed:

- Unchanged position, zero volume and a disclosed data gap each returned
  `Trades=1, MaxDrawdownBPS=0`; independent wide-integer curve calculation was 54.
- A new peak reached without another fill followed by a loss returned 0;
  independent curve calculation was 99 bps.

These are isolated synthetic regression inputs, not public market/strategy or
execution evidence. Their fixtures never ship as market data.

## Correction

Move peak/drawdown accounting into the existing `recordEquity` path for every
retained equity point. Use the existing checked wide arithmetic and existing
peak-to-trough formula. Keep initial capital in the peak, mark only actual input
rows, and retain gap disclosures. Do not interpolate missing rows, change
signals, fills, fees, slippage or permissions, migrate old receipts or execute
orders. Main, walk-forward, sensitivity and regime runs share this same path.

A full Service.RunBacktest receipt now records 54 bps, agrees with the curve
and survives state reload. Historical receipts remain unchanged.

## Executed checks

- Initial focused drawdown regressions reproduced all four wrong-risk cases.
- `go test -race ./internal/quantlab ./cmd/ynx-quant-desktop -count=1`: PASS
  (2.934s / 1.419s). Existing optional PostgreSQL checks are not a database
  deployment/capacity proof; no new database credentials were used.
- `go vet ./internal/quantlab ./cmd/ynx-quant-desktop`: PASS.
- Focused drawdown, persisted restart, idempotent replay and concurrent instance/
  tenant-isolation regressions: PASS.
- Actual controlled local Chrome `tests/browser.test.mjs`: 20 PASS, zero fail/skip.
- Full Quant npm test: 60 tests, 59 PASS, 1 retained FAIL
  `QUANT_ASSET_HASH_MISMATCH:styles.css`. No formal pin changed or gate waived.
- gofmt and `git diff --check`: PASS.

An initial combined Go command incorrectly targeted `./apps/quant-lab` (a
frontend directory) and failed setup despite the backend passing. The corrected
complete race/vet commands above ran against the actual desktop Go package.

## Delivery boundary

The final issuer must integrate this ordinary delta with the matching current
formal baseline, preserving its complete shared authority/module graph and
re-freezing exact build/source/public identities. No owner checkout is a formal
installer or replacement for the current website. Public deployment, installed
account approval, real strategy execution, signatures and transactions are not
proved by these local research tests; those gates remain false.
