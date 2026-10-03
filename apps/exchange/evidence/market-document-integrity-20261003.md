# Public market document boundary

Reviewed predecessor: `237775a5ba39990f1936755f83c1d11b3756e056`.

Before the fix, five actual createMarketFeed HTTP fixtures accepted duplicate
revision/price (including escaped duplicate key), an over-8MiB body and an
over-limit declared Content-Length. A duplicate SSE revision also called
onSnapshot again instead of retiring the stream. Six underlying cases failed
(the Node nested suite additionally counted its parent failure).

The original same-origin guest GET/SSE adapter now bounds decoded documents to
8MiB, decodes streaming UTF-8 strictly, scans before materializing deeply nested
JSON, rejects decoded duplicate object keys and limits nesting to 64. Unique
additive audit fields remain supported. JSON grammar and trailing bytes remain
validated by JSON.parse. No shared Wallet protocol or market schema changed.

Streaming reads are cancelled on timeout/offline/stop and excess bytes. The
existing epoch/revision/content fences, retry backoff and last-valid stale data
remain intact; invalid documents cannot replace them or fabricate live data.
Order book rows are not silently truncated to fit the bound. Over-limit data is
an explicit unavailable/error, not proof of venue capacity or a complete book.

Results:

- market-data tests: 30 PASS, zero skips/failures, including additive audit/null/
  escaped text, split multibyte UTF-8, deep/trailing/invalid UTF-8 rejection and
  stalled-body actual ReadableStream cancellation for deadline/offline/stop.
- controlled local actual browser candle suite: 3 PASS, desktop/mobile controls,
  read-only traces, stalled preview release and conflicting revision recovery.
  Screenshots were generated at
  `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-exchange-candle-display-6NfJG3`.
  These are local fixture screenshots, not public orders/trades or approval.
- complete npm suite: 93 PASS, 1 FAIL, 1 SKIP (95 tests); original unresolved
  `EXCHANGE_ASSET_HASH_MISMATCH:styles.css` remains. It was not waived or repaired
  by overwriting A's formal graph. Cache/import identities must be integrated by A.
- node syntax and git diff checks PASS.

A bounded read-only Node probe ran this source consumer against
https://exchange.ynxweb4.com/api/v1/market-data/snapshot: accepted YNXT-YUSD_TEST,
revision 478, 30 retained trades, file_snapshot/testnet/degraded_single_host,
polling phase. This is live-data compatibility of local source, not deployment
of this source or public provider/account/private-business proof. No writes,
accounts, credentials, signatures or transactions were requested.

Formal publication must retain the complete existing product, include this
module in PAGE4/MODULE4 source binding, refresh its import and final app/HTML
hashes, and pass the real asset graph gate. Historical publication inputs remain
historical, not silently relabelled as current. Source rollback is a normal
reviewed revert. Shared permissions/SDK, Finance authority and Host remain A's.
