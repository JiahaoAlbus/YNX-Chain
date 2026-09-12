# Exchange exact order preview — local source/build checkpoint

Source: `47a2deaac14e5cf72fda810483576fed7960500a`, tree `b38f462266a37df36b1136439ba7c3889ca88bd6`; predecessor guest-market checkpoint `481824aa053944982bc54b633c143454e0f21464`. Branch `codex/exchange-financial-flow-20260912`. Route unresolved issues to “接续测试网生态审计工作”, task `01a094cc-0ba3-7901-bcd5-56fce8330c0d`, through the Finance coordinator. Original Exchange worktrees remain preserved.

The existing public atomic market snapshot now includes versioned `tradingRules` from the running venue config, including exact decimal-string micro limits, maker/taker basis points and floor-notional/ceil-per-fill semantics. No second ledger or Wallet protocol is created. A guest can enter a plain decimal limit order, refresh source rules, and inspect the exact BigInt notional, single-fill fees and initial reservation. No POST, account request, signature or order is sent. Stale/offline rules fail closed. Missing account funds remain unknown, never zero or inferred from a standard Wallet connection. Single-host degraded versus PostgreSQL source status stays visible.

The preview explicitly refuses zero-quote rounding as an additional UI safety gate, not an already-enforced backend minimum. The existing engine admits such dust and uses per-fill fee rounding with potentially insufficient whole-order reservation. These engine invariants must be fixed/tested before submission is enabled. Single-fill fees are not described as a guaranteed maximum for fragmented fills. Market/stop orders remain unsupported. YUSD_TEST is non-withdrawable venue credit, not an on-chain token. Venue matching is not chain settlement.

## Verification

- `npm test --prefix apps/exchange`: 31/31 PASS.
- `go test ./internal/exchangeproduct ./apps/exchange/server`: PASS.
- `go test -race ./internal/exchangeproduct ./apps/exchange/server`: PASS, including two independent real HTTP/SSE guest processes and restart/retry cases from the prior checkpoint.
- Real Go server → HTTP snapshot → independent Node consumer: 10 exact order/fee/reservation vectors derived from engine `mulDiv`/`fee`, custom fees 17/43 bps; no state mutation.
- `go vet ./internal/exchangeproduct ./apps/exchange/server`: PASS.
- `npm run verify:wallet-connect --prefix apps/exchange`: PASS (source gate only).
- Exact module MIME/bytes: both `market-data.js` and `order-preview.js` served by the real static handler: PASS.
- Node syntax and `git diff --check`: PASS. Opt-in PostgreSQL integration unavailable (no configured test database); not claimed.

## Frozen offline runtime

`/tmp/ynx-exchange-47a2deaac14e-20260912-linux-amd64.tar.gz`: 3,703,450 bytes, SHA256 `ed2a66adf71a16bd9f605bd5dc2bd0e21f3d844b18b3a0c5716c6cf7e2e1a66d`.

Binary: 8,302,776 bytes, SHA256 `5e29e14ca7df8b8f109be9749f761af2526a9480b7644c1e4b5c825e885ac24d`; static Linux x86-64 ELF. Archive manifest includes six Web assets plus binary; internal `SHA256SUMS` checked after extraction. `order-preview.js`: 4,659 bytes, SHA256 `12aea3ea5e471adcea93013d2c5d7c13995a81330a61a33aa41256d9a59ade14`. Build uses exact source, trimpath, CGO disabled. This is an offline service artifact, not a user installer or hosted download.

## Remaining authority boundary

`/api/v1/account` and `/api/v1/orders` require existing `X-YNX-Product-Session-Proof`; order placement additionally verifies the native account action signature. The Web standard provider account is not that proof. No synthetic session or alternate ledger is introduced. New Wallet SDK `c97f85e9` was received after this checkpoint and is a separate follow-up consumer migration, not yet consumed here.

Public deployed / installed / browser-visible / real account approved / signed / order submitted / chain transaction / Product Session migrated flags all remain **false**. No SSH, remote execution or public site access took place. Rollback before deployment is selecting prior immutable source/artifact; any live release requires a separately authorized exact runtime/rollback plan.
