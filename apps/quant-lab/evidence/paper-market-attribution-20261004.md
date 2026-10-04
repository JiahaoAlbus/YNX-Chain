# Quant Paper market attribution — local source checkpoint

Source commit: `64eba865b20a7e5bac0ff0bebb66c9710ef839e8`

Source tree: `5dd7a9da027a5879d42cdda7ec5322bc690c187f`

Owner branch: `codex/exchange-sso-cookie-binding-20261002`.

## Change and boundaries

Original Paper market-adapter submissions now persist the exact adapter source,
price, volume and RFC3339Nano observation timestamp independently of execution
time. Missing observation time is omitted; no current-time substitute is created.
Existing manual-amount callers do not invent observation attribution. Added
scalar fields use omitempty, preserving absent legacy serialization/integrity.
Original durable locking, idempotent recovery, risk and settlement logic remain.

The original records UI displays escaped source and exact observation timestamp
only for consistent market metadata. Missing/invalid observations display an em
dash without reclassifying a valid historical order as a new verified market
observation. No source hyperlinks, orders, wallet prompts or authority are added.
Existing twelve-language Source/Observed labels are reused. App cache query binds
SHA256 `1832b46507b7639c2c035659c06afb504086a313228ff9cae18b2378a26d71cd`.

## Executed local tests

- Focused original persisted-engine tests, `go test -race ./internal/quantlab
  -run 'TestPaperReceiptsPreserveExactMarketObservation|TestDirectMarketPaperAdapter'
  -count=1`: PASS, 1.550s. Controlled adapter fixture only.
- `go test -race ./internal/quantlab ./apps/quant-lab/server -count=1`:
  PASS, 5.551s / 1.819s. No PostgreSQL URL configured for this invocation;
  this is not new SQL or public multi-instance acceptance.
- Focused Paper record VM tests: 4 PASS, 0 FAIL, 0 SKIP, 127.806875ms.
- `node --test apps/quant-lab/tests/business-flow.test.mjs
  apps/quant-lab/tests/cache-version-browser.test.mjs`: 116 PASS, 0 FAIL,
  0 SKIP, 2030.015333ms. Cache test launches local real headless Chrome;
  business tests use the shipped app with controlled DOM/HTTP boundaries.
- `git diff --check`: PASS.

## Remaining truth / release handoff

Paper fees and slippage are still NOT implemented. Backtest cost-model results
must not be described as Paper execution-cost evidence. Public deployment,
installed runtime, real provider approval, signing, testnet/live order and
Product Session completion remain NOT VERIFIED by this checkpoint.

No shared SDK/generated composition/Host/build/install/deploy changes. A release
owner must adopt a matching source-bound runtime before public validation. Do
not relabel any older artifact or public version with this source commit.

Recovery test reopens the persisted original engine with market adapter absent,
replays the exact request key, asserts identical receipt and unchanged state
integrity. Offset/nanosecond timestamps and absent times are covered; frontend
tests cover escaping, malformed dates, mismatched price/volume and all locales.
