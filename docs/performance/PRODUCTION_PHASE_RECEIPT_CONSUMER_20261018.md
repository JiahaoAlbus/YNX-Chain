# Consume production phase measurements without changing evidence layers

The existing `pq-batch-receipt.mjs` now exports `qualifyPQBatchMeasurement`.
It consumes the production owner's `ynx-pq-batch-measurement-v1` JSON together
with a receipt already bound to the original Whole wire and expected decimal
member values. It checks wire/batch/height/status/replay and every original
member outcome/hash/error, exact nonnegative int64 decimal nanoseconds, phase
attempt/completion/error accounting and safe integer counters. No second signer,
executor, business-state verifier or persistence path is introduced.

The result retains durations as strings, marks phase durations inclusive and
separates snapshot/marker file counters. Parent and child times must not be
summed as independent work. Published checkpoints require both actual file
boundary completion claims, matching candidate integrity and the local checkpoint
version. A snapshot Sync followed by a marker failure cannot publish a checkpoint.
Pending durable transactions can have execution height greater than the latest
checkpoint block height; the two fields are deliberately separate. Exact replay
has zero new signature/member work, and may have no persistence in this call.
All inclusion/BFT counts remain null. These checks qualify server measurement
fields, not proof that a benchmark or consensus event took place.

Production API source is fixed at `6a3b8f813bcc5a2ee8ab0280783b6ebddf3d9c71`.
Run13 actually passed full internal/chain and API packages; the owner formally
supplied this consumer contract after that result. The tests here use unsigned
format fixtures and cannot replace that Go execution evidence. Next measured
paired overlay consumption must call this same production API and preserve its
actual result/error; no new N case is authorized by this source change.

## Actual lightweight checks

Three new positive phase controls failed before the function existed. After
implementation, fourteen receipt tests pass. New cases cover exact nanoseconds
above JS's safe integer range, replay with zero work, marker failure despite
snapshot success, unsafe numeric counters, mismatched identities/outcomes and
inconsistent phase counts. Tests now use a static import so a missing function
cannot accidentally satisfy rejection assertions.

The existing local launcher also forwards explicit `--segmented-intents` through
one argument list shared by prepared plans, actual invocation and receipts.
It requires ready-pool plus terminal-stream and slot reuse. Its new prepare-only
control initially failed on the unknown option, then both launcher test groups
passed after the change. All finite resource/workload caps and default behavior
remain unchanged; no fixture/node/client executable was run by those checks.

```sh
node --test scripts/loadtest/pq-batch-receipt.test.mjs
node --test scripts/loadtest/consensus-local-window.test.mjs
```

## Fixed client's actual Go qualification

Run13 `39087492005` independently checked out fixed client commit `45058e7...`,
verified its tree and seven source hashes and actually passed all eight selected
Go functions, no FAIL/SKIP. The package reported 0.134s on Go1.25.13 linux/amd64.
The saved raw log is 112,794 bytes, SHA256
`9d431ef3c42bf3320b559df47f0c99f149313fdcbd43332f16a361d079a8d0ed`.
The whole workflow failed the existing production genesis boundary test; that
failure does not erase the separately executed client result. Original chain/API
package test times were 18.531s and 4.298s. These are correctness durations,
not business throughput or finality measurements.

`evidence/client-ci13-actual-45058e7-20261018.json` records all eight actual top-level
PASS names, the terminal package line and precise source/log identity. The newer
segmented implementation is excluded from this PASS. Its next exact checkout
and nine-function selector are in
`evidence/segmented-client-freeze-27f9515-20261018.json`; source publication and
one subsequent normal correctness run remain coordinated by Root.

## Read the original guarded pair without reconstructing a receipt by hand

`readGuardedPQPairedPhases(originalResultBuffer, guardReceipt)` checks the raw
result SHA against the completed guard, matching source/case, both original
member paths and the exact application member hashes. It consumes the existing
production measurement qualifier and emits one row per phase with exact
nanosecond strings and attempt/completion/error counters. It also rejects a
production total longer than its outer API interval. It does not sum nested
phases or convert component intervals into a sustained throughput claim.

Both the result and guard must come from the approved original run. Matching
hashes and fields establish self-consistency, not authentication of the artifact
origin or a new ledger/consensus proof. The output keeps effective inclusion,
final commits, sustained TPS and consensus finality null. Old Run10 output has
no production measurements and cannot be silently promoted into this table.

Two new controls actually failed before the reader existed. All sixteen receipt
controls now pass, including stale digest, failed child/guard, missing cleanup,
changed source/case and a changed member identity with a recomputed report hash.
Fixtures remain unsigned format-only. No new Go or pair was run for this reader.

## Source handoff availability

The exact six-file measured-overlay patch is retained under
`artifacts/chain-performance-20261017/measured-api-handoff-b654bb5/` with its
before/after/source/observed-target pins. It is 29,305 bytes, SHA256
`6516cfa6719375450cff0c94de428c5b2e4a88045346d19a3536e5c94ff1a60d`.
The target's six leaves matched all expected before pins when captured. Only
its original owner applies the patch; no target file was modified here.

After Root's next source-delivery instruction, a fresh remote read returned
27f9515, the independent ancestor check returned0, and normal exact-commit push
of b654bb57156138310a2e14f12dd9180596f98e05 completed0. A subsequent ls-remote
returned that same full SHA. This enables the original CI to read only the six
frozen overlay/preparation/guard files, while its nine-function client job still
checks out 27f9515 separately. It is source supply, not a compile/pair result.
