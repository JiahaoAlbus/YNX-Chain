# Exchange public market revision-gap recovery

Owned source change only; no deployment, account approval, signature or trade.

Baseline: d0457a5684fa590c7b4548308f7998075d034c35.

The server emits a full `reconciled` snapshot when its persisted-state fingerprint changes. A heartbeat has only a revision, not depth, trades or a new source observation timestamp. Previously a heartbeat ahead of the applied snapshot merely renewed the watchdog, leaving stale depth labelled live. Two new tests failed against the original implementation (live instead of reconnecting; no recovery timer).

The client now invalidates that stream epoch, labels its last verified snapshot reconnecting with `MARKET_REVISION_GAP`, and performs a bounded, credential-free same-origin GET. Delayed events from the old stream cannot replace the snapshot. Read failure retains the verified old data as stale and uses existing bounded backoff. Equal-revision heartbeats remain keepalives; they do not invent a new source timestamp or market data.

Validation:

- `node --test apps/exchange/tests/market-data.test.mjs apps/exchange/tests/order-preview.test.mjs`: 19/19 passed, no skips.
- Focused Go race tests: public source/backend disclosure and durable SSE reconciliation/disconnect passed.
- `TestGuestClientConsumesActualHTTPAndMatchesForTwoIndependentReaders`: actual local Go HTTP/SSE and two Node readers; isolated test assets, not public transactions.
- `git diff --check` passed.

Integration: release owner must incorporate the changed module into its coherent versioned Web asset graph and final release. Existing app import hashes are deliberately not superficially rewritten here. Public runtime, installed runtime, real Wallet lifecycle and real orders remain unverified for this delta. Source rollback is omission/revert of this isolated client/test change followed by release-owner rebuild, not a production command.
