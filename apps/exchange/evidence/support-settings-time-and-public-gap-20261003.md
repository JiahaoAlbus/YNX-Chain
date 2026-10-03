# Exchange owned support/settings time and publication gap

Inherited baseline `ebf1405f5e05b79682705f92dced5dc599ae7a86`, branch `codex/exchange-sso-cookie-binding-20261002`. Changes: ordinary Exchange renderer and direct tests only. No Wallet/Auth/SDK/permission, native order signing, Finance authority, Host, formal release or persisted data changes.

## Executed correction

Support history previously sorted timestamp strings, placing `2026-10-03T09:00:00+09:00` ahead of the genuinely later `2026-10-03T01:00:00Z`. Missing/numeric-looking times became browser-invented dates; security settings used Date.parse normalization and accepted February 30 as a source timestamp. Added real-Chrome regression failed before the fix at the incorrect newest case.

The ordinary support/settings renderer now reuses the existing `ownedRecordOrder`, `ownedRecordInstant` and `ownedRecordTime` helpers already used by owned orders/history. No second parser is introduced. Unknown timestamps remain unknown, known dates follow the selected document language, and source snapshot JSON is unchanged. Account filtering and local per-owner draft recovery remain in place.

## Local verification

- Full owned-control real-Chrome suite: 6/6 PASS, 11540.307041 ms (including logout race/failure recovery, account-bound support drafts and the new timestamp case).
- Final expanded known/unknown settings locale regression: 1/1 PASS, 1119.850667 ms; 12 languages; actual-instant ordering, unknown shown as em dash, malformed source time unavailable, valid settings time localized, source JSON byte-identical, page errors zero.
- Market/candles/owned-record integrity: 44/44 PASS, 88.795167 ms.
- Shipped Exchange page candle/order-preview Chrome suite: 4/4 PASS, 7009.664417 ms; bounded preview recovery with no order, stale source/retry, best depth, desktop/mobile and 12 locales. Retained controlled local screenshot root `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-exchange-candle-display-B7zjtI`.
- JavaScript syntax and diff checks: PASS.

These isolated renderer/page tests do not prove private API authentication, real Wallet approval, public account lifecycle, cancellations or transactions. No actual account/write action occurred.

## Fresh public readback (same turn, bounded unauthenticated HTTPS GET only)

Every following endpoint returned HTTP 200 and JSON. Exact public source identities are still older than the ordinary owner changes; successful HTTP is not source-bound delivery of this fix.

| Public receipt | Bytes | SHA256 |
| --- | ---: | --- |
| Finance `/version`, source `81e08b49d1eec3d901433e54d6b35227be43b6b3`, release `finance-authority-diagnostic-81e08b49d` | 140 | `4f29004ada07b1460807d189a4cc7c394bd704038fb12212268ee854777654d3` |
| Finance `/health` | 557 | `438bdb4da5eaf42fe8256dba0970eb6ad7fc72b7e618da81572eed4b517f3268` |
| Exchange `/api/version`, source `91c1a40587d28ad4c931d4a4d601766bd467ea20` | 107 | `b4c022607d648d184914ec7e9041fc4e7c5c2ce5fcc13392f18350bfc2a6d8a8` |
| Exchange `/api/health` | 307 | `9d16623ea43cc49bd257b1043c14bd1f1cd1d68a8df4b8e754a1ff2c5dbdc7de` |
| Quant `/api/version`, source `664b80b00ac576317524f25b49fc01d1c0db7196` | 274 | `f82629a1bd63e50f6721611cbf7866f86d7bffd51820b05a417590541c4653df` |
| Quant `/api/health` | 462 | `9f20f70d5719359683c2f2e4a0dabacd7003072d01b16e1930520ea79b01b4cb` |

Hosts: `finance.ynxweb4.com`, `exchange.ynxweb4.com`, `quant.ynxweb4.com`. Quant public storage explicitly reports `filesystem_json_snapshot`, `multiInstance=false`, `productionDatabaseRequired=true`, `restartPersistent=true`, `crossProcessSharedFilesystem=true`; not a PostgreSQL/multi-instance acceptance claim.

## Exact next integration actions, not completion

1. A must integrate ordinary product hunks into its current coherent graph and publish source-bound successors with formal rollback/artifact/install evidence; do not replace the whole inherited checkout or silently rewrite pins.
2. Exchange app `requireProductSession()` currently reports `API_UNAVAILABLE`. Cancel/deposit/withdrawal/settings/support/AI controls retain this boundary; existing `exchange:read` cannot be promoted into trading/write authority. To implement those authenticated actions, the shared owner must provide the accepted separate write-scope/native exact-signature/one-time-proof consumption contract. Do not fabricate it or request a user's private key.
3. Public account approval/refresh/logout/multiuser business and installers remain unverified. This turn's concrete gaps and exact integration request were sent only to `接续测试网生态审计工作`.

Rollback of the implemented change is a normal successor revert of the support/settings renderer/test hunk; no server, storage or production restoration is needed.
