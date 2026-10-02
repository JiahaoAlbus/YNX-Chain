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

## Unchanged-market observation renewal

Successor baseline: e3f3a5b60b4b93473c39b583c5957a9f36c69e7d.

Healthy unchanged SSE sessions previously kept the original source timestamp indefinitely. The advisory preview correctly rejects observations older than 120 seconds, so even a connected quiet market eventually required manual retry. The client now schedules a real snapshot GET every 60 seconds while SSE is active, independent of heartbeat arrival. It replaces the stream through the existing epoch/abort fences. Only returned `sourceMetadata.asOf` changes observation freshness; neither client time nor heartbeat revision is substituted. No-stream polling retains its existing five-second cadence. Offline/stop/reconnect cancels the observation timer.

Two new timer-controlled tests failed before the change (missing real-refresh timer), then passed. They cover same-revision renewal, unchanged timestamp on heartbeat, late old-stream exclusion, failed refresh retaining stale verified data, and terminal timer cancellation.

Validation: Node syntax and combined market/preview tests 21/21 passed, zero skips. Actual local Go race HTTP integration for two readers plus configured engine-rule vectors passed in 6.519 seconds. The one-minute timer is deterministically exercised locally, not a claimed public/browser soak. This is an ordinary read-only product improvement; no permission, API shape, execution engine or service data mutation.
