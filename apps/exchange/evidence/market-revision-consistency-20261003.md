# Market revision consistency and recovery

Reviewed predecessor: 8172559aefc3d612bdd25390eaecce5c611a0de6.
Owner branch: codex/exchange-sso-cookie-binding-20261002.

The existing authoritative server (`internal/exchangeproduct/public_market_snapshot.go`)
binds public revision to persisted `state.Sequence`. Observation timestamps and
transport health can change independently, but depth and matches must not change
under the same revision. Existing client code rejected lower revisions but
accepted conflicting equal revisions. Both SSE and manual HTTP fail-first tests
proved this defect before the fix.

The client now captures a canonical projection of verified depth and retained
matches before notifying the view. Equal revisions require identical record
identity, side, prices, quantities, creation timestamp and match provenance.
Row ordering and fresh observation timestamps are excluded from the comparison.
The comparison is a local consistency fence, not a cryptographic attestation or
proof that arbitrary server data is authentic. Existing source validation still
applies before this fence.

On conflict the last valid snapshot remains cached, the source is labelled stale,
the stream is retired and bounded GET reconciliation is scheduled. A verified
newer revision recovers normally. No synthetic prices, history, orders or
automatic write retries are introduced.

Tests:

- Equal-revision depth price/fill/removal and trade amount/digest/removal conflicts:
  rejected; cached snapshot preserved; stream retired; timers removed on stop.
- HTTP conflict then higher-revision recovery: PASS.
- Same-revision reordered records and source observation refresh: PASS.
- Actual Chromium production feed + K-line renderer + connection status: conflict
  preserves rendered trace, exposes stale notice; explicit verified retry updates
  chart and clears stale notice; exactly two read calls and one browser tab.
- Market/candles/browser/order-preview/owned-record suites: 35/35 PASS, zero skip,
  3674.016708 ms, including desktop 1440 and mobile 390/320 candle regressions.
- `go test -race ./internal/exchangeproduct -count=1`: PASS, 14.557 s, including
  existing real local HTTP/SSE two-reader matching integration.
- Module/test Node syntax and git diff checks: PASS.

Browser transport data and matches are controlled fixtures; Go integration uses
an isolated local test venue. Neither proves public-chain trades or person-owned
public execution. Shared Wallet/Auth and final asset pins are unchanged. Final
source-bound public/installed integration and real approval/trade gates remain
unproved. No production mutation occurred; ecosystem goal remains incomplete.
