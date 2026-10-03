# Exchange actual engine → two guest HTTP readers → reconnect

Source parent: `0bc0137abd318db29912e6498af0e2a239d903f8`.
Only existing Exchange ordinary transport test and this evidence changed.
No server, shared authority, Wallet scope or production release was modified.

Executed the actual Go Exchange regression under race detection, then extended
the existing real HTTP/SSE integration. The Go fixture uses test-only keys and
controlled chain input to drive the actual matching engine. Two separate Node
processes consume its public snapshot/stream with the real Web market adapter.
The resulting actual match yields a 4,000,000-micro fill and matching provenance.
One-, five- and sixty-minute candles bind that retained trade, exact volume and
source digest; retained candles remain explicitly incomplete coverage.

Both readers now explicitly enter offline, close transport and Retry via a fresh
real HTTP GET. Order rows, trade provenance, revision and computed candles remain
exact after recovery. Source metadata remains identical except for a freshly
read `asOf` which cannot move backwards. Recovery must report live only after
the read succeeds. Every guest request remains GET with no order submission.
An initial over-strict test compared refreshed observation timestamps byte-for-
byte and failed; the final assertion distinguishes source observation from
immutable venue state rather than suppressing the refresh.

Results:

- Initial full `go test -race ./internal/exchangeproduct -count=1 -timeout=120s`
  passed, 14.326 s, before the transport-test extension. This does not prove
  optional external PostgreSQL tests executed without their database fixture.
- Final extended real two-reader integration ran twice, both PASS, 6.598 s.
- Web market, candles and order-preview tests: 46/46, 94.437375 ms.
- No installed-provider/public account/grant/sign/transaction proof is claimed.

```sh
go test -race ./internal/exchangeproduct -run '^TestGuestClientConsumesActualHTTPAndMatchesForTwoIndependentReaders$' -count=2 -v -timeout=60s
node --test apps/exchange/tests/market-data.test.mjs apps/exchange/tests/candles.test.mjs apps/exchange/tests/order-preview.test.mjs
```

This is controlled local source integration, not publicly settled Testnet trade
or proof of user-owned credentials. Source-bound public publication still needs
the current release owner; actual product order writes require accepted write
scope and exact native Wallet signature/proof consumption, not promotion of the
existing read grant or a parallel SDK. Preserve all formal pins/Host boundaries.
