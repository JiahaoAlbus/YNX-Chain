# Exchange market SSE transport retirement — local source evidence

Parent: e245ea7092ae027d01fc872199ee18c25db84367. Worktree: exchange-sso-cookie-binding-20261002; branch: codex/exchange-sso-cookie-binding-20261002.

## Reproduction and correction

Direct original Server.ServeHTTP regression reproduces ignored transport errors: FlushError and SetWriteDeadline failures both retain the stream until cancellation (two failures at 200ms). A source-loss case also failed because FlushError was never invoked (deadlines=980, flushes=0 during the one-second bounded probe). Red run: package failure, 1.768s.

Use the existing HTTP ResponseController for every SSE frame. Renew a 10-second write deadline, propagate actual deadline errors (only ErrNotSupported retains compatibility with in-process writers), propagate write/flush errors, and terminate the subscriber immediately. Source-unavailable also uses the bounded writer before terminating. Snapshot/reconciliation/heartbeat schemas, durable source checks, guest permissions, matching engine and trades are unchanged.

Direct tests assert failed transport exits without relying on cancellation, deadline failure writes no body, flush failure is observed exactly once, and both concurrency semaphore and in-flight count return to zero. The actual durable-file source-loss test verifies both emitted frames receive fresh deadlines. Existing real two independent Node HTTP readers and original test-signed matching/restart tests remain in the focused gate; these are isolated fixtures, not public/user Wallet approval or real-money execution.

## Executed checks

- `go test -race ./internal/exchangeproduct -run 'Test(MarketStream|MarketDataStream|OpenMarketStream|Guest)' -count=3`: PASS, 12.742s.
- `node --test apps/exchange/tests/market-data.test.mjs`: 36/36 PASS, 0 skip, 98.727167ms. Includes reconnect/offline/revision-gap/source-loss/retired-response and bounded body reads.
- Final `go test -race ./internal/exchangeproduct`: PASS, 12.527s, including final capacity-release assertions.
- `go vet ./internal/exchangeproduct`, gofmt and `git diff --check`: PASS.
- No PostgreSQL opt-in run, formal release build, public deploy, native installation or ComputerControl performed in this checkpoint.

## Release boundary and rollback

This is owner source only. Current publicly observed Exchange source remains old 91c1a40587d28ad4c931d4a4d601766bd467ea20 (previous checkpoint public read); no new public read or mutation is claimed here. Protected main/producer/profile assembly and actual source-bound public release remain centralized with the release owner. All public/new-native/Wallet approval/Product Session/sign/order/transaction completion gates remain unproved.

Rollback in a future approved assembly: omit or revert only this checkpoint's two owned Go files, retain e245 observation isolation and all unrelated work, and rerun the above gates. Do not reset a shared worktree. Handoff/problems sent exclusively to 接续测试网生态审计工作 (01a094cc-0ba3-7901-bcd5-56fce8330c0d). Overall Finance-suite goal remains incomplete and continues.
