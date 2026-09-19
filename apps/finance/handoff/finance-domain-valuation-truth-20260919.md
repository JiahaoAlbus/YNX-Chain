# Finance domain valuation truth — 2026-09-19

Implementation checkpoint: `a762227c1c88f2cf2a119795b80a3ff8181eaa84` (`5764cfb56f53c420d3b5c03632a01a7df1b8d37c`).

The Finance domain portfolio endpoint no longer converts missing Explorer account evidence into a numeric zero. It now separates four cases:

- unavailable account evidence: `valuationStatus=unavailable`, a stable reason code, no numeric total, and an explicit empty holdings list;
- observed zero: `valuationStatus=observed`, total `0`, and an explicit zero YNXT holding;
- account-only evidence: balance and stake remain observed when the bounded activity request fails after the account response was validated;
- negative or overflowing amounts: fail closed as unavailable and emit no valuation.

This is an additive API contract change. Existing numeric fields remain decimal strings when observed. `totalValue` is omitted only when unavailable; consumers must use `valuationStatus` and must not coerce an omitted value to zero.

Verification passed: Finance Go race tests, Finance Go vet, server/worker builds, 65 Web tests, and the Finance security scan across 389 text files. The full repository test command still has unrelated existing failures because the devtools `SampleEVMWriteCounter.json` contract artifact is absent; the Finance packages passed within that run.

No deployment, Wallet approval, signature, transaction, or official Broker Sandbox execution was performed. All such truth gates remain false.
