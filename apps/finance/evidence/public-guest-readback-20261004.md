# Direct public Finance guest readback

Observed UTC 2026-10-03T16:06:54.383Z (Asia/Shanghai 2026-10-04).
Owner predecessor `ddc54cecebd51ab0500326327cb7fd0f9b8c2f1b`.

## Fresh authoritative public change

Finance is no longer the previously observed HTTP 502. Direct GETs and real installed Google Chrome now show HTTP 200. `/version` identifies commit `17d2d6dd0f9e30c7639bb5ccdf919c4896280e6c`, release `root3-lifecycle-17d2d6dd0`, buildTime `2026-10-03T01:40:39Z`. This is a newly observed public runtime, not an owner deployment performed here.

| Public object | HTTP | Bytes | SHA256 |
| --- | --- | --- | --- |
| `/version` | 200 | 127 | `92eee2e51b111513df0f3637bf257aad8ac1d532c96a2e3640f6b07e7b5abaa8` |
| `/health` | 200 | 544 | `7e6f037a79c7dce4780437087e09c7e4227fa23797b84292d47371d6d6061476` |
| `/app.js?v=6038c02a3e20d144f8f887d9f8cff9d4c91ae6541342496f9a8e0e0a0925e390` | 200 | 94133 | `6038c02a3e20d144f8f887d9f8cff9d4c91ae6541342496f9a8e0e0a0925e390` |

Version/health MIME `application/json; charset=utf-8`; app MIME `text/javascript; charset=utf-8`. Public script query identity equals the fetched bytes hash.

## Direct non-sensitive browser gate

Executed `node apps/finance/scripts/verify-public-guest.mjs`, exit 0. Real public URL `https://finance.ynxweb4.com/#overview`, title YNX Finance, default language en, direction ltr. All twelve actual language choices set the requested HTML language and direction (Arabic rtl); switched back to English and reloaded. Final URL unchanged, one tab, no uncaught page errors, zero blocked write requests. Visible guest copy explicitly separates identity, Wallet connection and private approval; missing balances/quotes are not estimated. No provider request, approval/rejection, signature, transaction, order or private business call was performed.

New reproducible verification command rejects non-GET/HEAD/OPTIONS browser requests and has no connect/sign/transaction action. It prints only non-sensitive public receipts and never mutates Host, release or service configuration. It does not turn guest success into product completion.

## Integration still needed

Public app is not byte-identical to owner app (114639 bytes, SHA256 `2ba7f5612dfdeeb04f5ed32c0aba38a069cdc058e5466755b8c70364fe6f3ead`). Distinct coherent authority graphs can legitimately differ, so this alone is not a regression verdict. Specific ordinary repair markers also remain absent: strict receipt availability, `readablePlanningRecord`, translated reminder frequency. Exact public renderer inspection is required alongside the markers; Central should integrate the ordinary fixes from `23dba18510dc986cb3a8b930b8f8be2bb35e16da` and `ddc54cecebd51ab0500326327cb7fd0f9b8c2f1b`, not replace its full shared graph with this owner branch.

Additional direct static public readback (same exact app URL, exit 0) confirms the older implementation, not just absent string markers: `renderReceipts` directly reads `status.available` and `items.length`; dispute href is raw escaped `r.disputeUrl` rather than the owned strict navigation helper. `renderPlanning` directly reads each array/row and `progress.find(p=>p.budgetId===b.id)`, and prints raw `r.schedule`. These ordinary function hunks, including the preceding owned HTTPS-link guard, must be included in the coherent release. No executable link was clicked and no malformed data was sent to production.

Fresh direct JSON version readback for Exchange remains `91c1a40587d28ad4c931d4a4d601766bd467ea20` (`/api/version`, 107 bytes SHA256 `b4c022607d648d184914ec7e9041fc4e7c5c2ce5fcc13392f18350bfc2a6d8a8`); Quant remains `664b80b00ac576317524f25b49fc01d1c0db7196` (`/api/version`, 274 bytes SHA256 `f82629a1bd63e50f6721611cbf7866f86d7bffd51820b05a417590541c4653df`). Quant public storage reports multiInstance=false/productionDatabaseRequired=true. These have not been promoted to current owner source or full business acceptance.

Provider approval/callback, private Product Session, real owned backend reads/writes, native installation and complete goal remain unverified. Unique release owner retains deployment/rollback authority; this work made zero production writes.
