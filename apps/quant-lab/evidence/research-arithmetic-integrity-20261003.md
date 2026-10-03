# Research arithmetic integrity

Reviewed predecessor: `9a7c9efd8ce3d68264be00492c4ceb4b8c8d85a8`.

Actual engine regression reproduced a negative buy-and-hold equity on a flat
100000000-micro price series: expected 100000000000, actual -84467440737.
The multiplication overflowed int64 before division, though the quotient fits.
The pre-fix TestResearchFlatPriceBenchmarkDoesNotOverflowIntermediateProduct
failed through Service.RunBacktest, not a reimplemented calculation.

The existing moving-average simulation and formulas are retained. Integer
products and sums use math/big before narrowing; division still truncates toward
zero. This covers benchmark/equity/return/drawdown, participation, trading costs,
entry price, realized attribution and sensitivity spread. Moving-average and
idle-capital sums retain wide intermediate totals. There is no clamping,
float-based money arithmetic or arbitrary new price/cost cap. Nonrepresentable
int64 outputs and nonfinite/out-of-range floating risk metrics return
invalid research numeric_range before persistence. Historical record decoding
is unchanged; previously saved experiments are not recalculated or rewritten.

Regression coverage:

- Flat-price actual engine: equity and benchmark both retain starting capital.
- Max/min int64 multiplied by two then divided by two remain exact.
- Signed negative division preserves truncation, not floor rounding.
- Truly out-of-range quotient, zero divisor, MinInt64 absolute, NaN/infinity and
  risk metric conversion boundaries fail closed.
- An unrepresentable benchmark from the actual engine returns ErrInvalid; a
  pre-existing persisted experiment's state bytes remain identical.
- Original deterministic/OOS, attribution, replay, cancellation, lifecycle and
  actual server regressions remain included in the full package run.

Final local results: `go test -race ./internal/quantlab ./apps/quant-lab/server
-count=1` PASS (3.336s / 1.861s); `go vet` both packages PASS;
`git diff --check` PASS. PostgreSQL-dependent skips are not concurrency proof.

This fixes local research correctness, not live trading/account permission.
Shared SDK, Finance authority, registered clients, formal pins, public runtime,
DEX/Pay and other owners were not changed. Public/native release, true user
approval, signing and transactions remain unverified. A must inherit matching
ordinary Quant server source in the formal build graph before public validation.
Rollback is a normal reviewed source revert, not a production operation here.
