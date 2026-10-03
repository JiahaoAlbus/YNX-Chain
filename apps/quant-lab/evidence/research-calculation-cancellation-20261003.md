# Calculation cancellation and exact window cost

Reviewed predecessor: `308cfbe1389c0b2e1a1b57c456624aab4e7d996a`.

Actual Service.RunBacktestContext regression before the fix completed with nil
error and only two context checks. A deterministic real cancellation at the
tenth calculation checkpoint was never reached. Prior commit/market cancellation
checks did not prove calculation cancellation.

The original request context now reaches the main calculation, walk-forward,
sensitivity and regime calculations. Price-prefix construction checks it once
per input row and simulation checks it once per output row. No abandoned worker,
automatic retry or post-commit undo is introduced. Four cancellation checkpoints
(10/60/80/400) all stop at the exact checkpoint, return context.Canceled and keep
the pre-existing experiment's disk bytes unchanged.

Wide integer price prefixes replace repeated long-window scans. One linear
prefix per calculation and two bounded prefix differences per eligible signal
retain the original exact average and truncation, without new defaults/caps.
Every nonempty interval of the existing 48-bar fixture, including MaxInt64 price
rows with unrepresentable intermediate sums, matches direct wide summation.
Existing deterministic/OOS/equal-window/numeric rejection tests remain enabled.

Final results: race internal 3.404s / server 1.673s PASS, vet PASS, diff PASS.
Darwin arm64 Apple M4 local microbenchmark, 100ms:
10000-row prefix average 23.39 ns/op, 16 B/op, 2 allocs/op. This measures an
already-built single average, not full backtest latency or public capacity.
Independent PostgreSQL QA still needs real execution, not a promoted SKIP.

No shared grant/SDK/authority, formal pins, Host, public/native release or stored
historical experiment changed. Existing source capabilities are inherited, not
replaced with a helper/demo. Local QA artifact receipts are not a product update.
A must merge the complete matching source against the actual formal baseline;
source-only evidence does not prove real user identity/business or installation.
