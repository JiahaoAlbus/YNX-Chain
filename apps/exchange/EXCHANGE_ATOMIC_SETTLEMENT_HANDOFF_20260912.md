# Exchange funded settlement checkpoint

Implementation `99afe8c7dd610404b49a8cd414e58b93e684d9c8`, tree `0e73ad229f70990334a68614013a12a14c2c98cd`, inherits clean preview `0283f7e20be5b83a8646b740865ed9234afa7183` on `codex/exchange-financial-flow-20260912`. Only Exchange owner paths changed; no migration of persisted state format, second ledger, SDK or other product changes.

## Fixed invariants

- Positive inputs whose floor notional is zero are rejected. Existing dust remainders cannot exchange base assets for zero quote credits; a non-executable pair is skipped, with its funds still reserved/cancellable.
- A fill debits its own buyer/seller order reserves exactly. Aggregate reserves must cover those orders. It no longer truncates a debit with `min` while crediting full assets/fees.
- Fees still round upward per fill (business rule preserved). If fragmented fees exceed the signed order's initial reservation, the entire *new* order request fails atomically: no extra available-balance withdrawal, borrowing another order's funds, or saved partial matches. Existing prior fills/orders remain unchanged.
- Failure restores balances, orders, sequence, audit, idempotency, fees and in-memory revision; disk bytes unchanged. Cancellation also fails closed and restores its before-state if exact reserve release is impossible.
- Receiver balance and reserve-sum overflow are rejected. Fee calculation now splits before multiplication, remaining exact through positive int64 values for valid rates. Startup already rejects maker greater than taker, negative or over-1000-bps rates; explicit tests added.
- Public `exchange-limit-rules-v2` declares minimum one quote micro and `atomic_order_request_rejection` shortfall behavior. UI explains the unchanged per-fill rounding and rejection policy, not an unfounded guarantee of full execution.

## Local verification

`npm test --prefix apps/exchange`: 31/31 PASS. `go test -race ./internal/exchangeproduct ./apps/exchange/server`: PASS, including two-user concurrent matching, idempotency, persisted restart, two independent real HTTP/SSE guest readers and the following nine new invariant tests: dust admission/remainder, atomic fragmented-fee shortfall, no cross-order reserve borrowing, aggregate reserve corruption, release deficit, int64 fee arithmetic, unsafe fee config, fully funded fragment conservation, receive overflow. Conservation assertions reconcile ledger deltas, order reservations, user balances and venue fee records. Test keys and chain records are isolated fixtures, not production/testnet execution evidence.

`go vet` for both packages, Node syntax, standard Wallet source gate, static JS MIME/bytes and diff whitespace checks PASS. Optional PostgreSQL integration tests remain unavailable without a configured test database; concurrent local fixtures are not multi-instance production proof.

Offline Linux amd64 archive `/tmp/ynx-exchange-99afe8c7dd61-20260912-linux-amd64.tar.gz`: 3,704,416 bytes, SHA256 `b7a7ee0d5cb2adc0be436a6c9230ccbb34462f50f24605997277a39e50d66bf3`. Static executable: 8,306,872 bytes, SHA256 `27102502be270aef574c28907ff951d068d8b85e88731acfd55163512434292d`. Six Web assets plus binary and per-file manifest. This is an offline service artifact, not an installer/download release.

## Still false / next

No public deployment, browser/device verification, actual Wallet permission, signature, transaction or real venue order occurred. Standard Wallet does not grant Exchange private account/order authority. Product Session proof/native action-signature integration remains gated. Shared SDK `c97f85e9` consumption is a separate next checkpoint. The conservative fragmentation rejection is safe but can leave a crossed underfunded old order until its owner cancels; a future cumulative-fee policy must be separately specified/migrated, not silently inferred here. Market orders, OHLC candles, withdrawal broadcast and end-to-end real Wallet→funded venue flow remain unproved/unimplemented as previously disclosed.

Route status and unresolved issues only to “接续测试网生态审计工作” (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`) through the Finance coordinator. Any public deployment requires a new exact runtime/rollback authorization; local rollback selects the prior immutable checkpoint/artifact.
