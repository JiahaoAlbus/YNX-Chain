# Exchange preview cancellation recovery

Predecessor: c2b99d32e051ee5b74e72f31470365a9ac0e2c99.

## Defect and correction

The deadline retired the market epoch and aborted its signal, but a transport
that never settled could leave `marketFeed.retry()` pending indefinitely. The
shipped review handler awaited this promise with its button disabled. Refresh
now races both the HTTP response and body read against signal cancellation.
Its listener is removed in finally; retired epochs still cannot apply late data.
Deadline, offline and stop release callers without accepting a snapshot.

## Executed verification

- Node market-data, order-preview, candles and candles-browser tests: 33/33 PASS,
  zero skipped, 3888.504125 ms.
- The real local Chrome fixture clicks the shipped preview handler, observes
  disabled state, triggers its injected deadline, and observes the control
  unlocked with the unavailable-rules error. No dialog opens, no order POST,
  Wallet call or additional tab occurs. The transport is deliberately stalled.
- The fixture is controlled local display evidence, not public connectivity,
  real network-loss duration, account approval, or transaction evidence.

Public deployment, installer, real Wallet/account approval, private Product
Session and execution gates remain unproved. Shared Auth/SDK and release-owner
graphs are unchanged. This source fix does not authorize order execution.
