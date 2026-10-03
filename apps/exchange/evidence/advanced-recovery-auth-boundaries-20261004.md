# Advanced-order recovery authentication boundaries

Inherited implementation: d9d8043d24d1e405f5bc94103ae9d45e8b663719 / tree cf0bb13d35eb22a89448c4d98e3e1e8d4063fc49. Production logic is byte-unchanged. This successor extends the existing local engine recovery tests, not Web write permissions or shared protocols.

All five real PostgreSQL/two-OS-process recovery cases now submit an original replay with its native fixture signature removed and require HTTP 401. All rejected requests (changed same-key intent, separately signed foreign account, fresh expired intent, unsigned replay) must omit the original persisted effect ID. Exact authorized replays still return byte-identical terminal JSON after twelve concurrent requests and a third-process restart; full durable state and both users' ledgers remain unchanged.

Ten file-backed fault-injection cases exercise the actual service methods for Conditional/OCO/TWAP/Scale/Iceberg: an idempotency record naming a missing effect, and an effect whose account no longer matches the authenticated owner. Both must fail forbidden without rewriting or recreating state. These controlled corrupt-state cases test fail-closed cache ownership, not a claim that production state has been corrupted.

Executed `go test -race ./internal/exchangeproduct -count=1` with real loopback PostgreSQL configured: PASS 63.292s. `go vet ./internal/exchangeproduct`, gofmt and diff checks: PASS. Zero isolated Exchange test schemas remained; the retained owned QA cluster stopped normally.

## Fresh read-only public binding

Public HTTP readback completed before 2026-10-03T23:21:38Z (local date 2026-10-04). No account request, signature, order, wallet interaction, deployment or server mutation occurred.

| URL | Status | Bytes | SHA-256 |
| --- | --- | --- | --- |
| https://exchange.ynxweb4.com/api/version | 200 | 107 | b4c022607d648d184914ec7e9041fc4e7c5c2ce5fcc13392f18350bfc2a6d8a8 |
| https://exchange.ynxweb4.com/api/health | 200 | 307 | 9d16623ea43cc49bd257b1043c14bd1f1cd1d68a8df4b8e754a1ff2c5dbdc7de |
| https://exchange.ynxweb4.com/ | 200 | 15995 | e19bfb7281f35515b5d5648f893803af94ea3a0c64ed46d766f3495a8e7b63ab |

Version is still `0.1.0-testnet`, commit `91c1a40587d28ad4c931d4a4d601766bd467ea20`, productId `ynx-exchange`. JSON MIME for version/health and HTML MIME for root were observed. HTTP 200 is not evidence that the current owner source or any authenticated business journey is published. Public source binding remains mismatched; actual Wallet/native/install/Product Session v2 business-write and public testnet execution gates remain unproved.

Send this precise dependency to the active `接续测试网生态审计工作` coordinator: A must integrate the compatible preserved owner graph and supply the accepted canonical business-write producer/mount and formal release. No private keys or internal API implementation should be requested from the human user; no fabricated Web write grant is permitted.
