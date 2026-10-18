# Bounded signed-intent segments for the existing load client

New `ready_intent_segments.go` adds the signed-input counterpart to the existing
terminal evidence segments. It reuses `persistTerminalSegment` for exclusive
creation, write, file Sync, close and directory Sync. It is not a transaction
state store, authorization provider or resubmission queue.

Each append captures one ready wave (1..64 envelopes) in one private file. The
header binds fixture manifest/migration/genesis, segment number, first record,
record count, previous file SHA and payload SHA. A successful append advances
record/byte/chain/nonce counters only after the complete persistence call returns.
An error poisons the writer, retains partial or complete uncertain files and
forbids further append or close-as-success. There are no deferred records at close.
Record/byte limits are explicit constructor parameters, at most the existing
terminal 1,000,000-record bound and 1GiB. A capacity/order failure stops the writer.
These bounds are implementation limits, not permission to run such a workload.

Readback inventories filenames in chunks of 64, captures/checks one bounded
segment at a time and adapts its payload to the existing incremental V1 scanner.
That scanner still verifies every native signature and sender/nonce/template.
Missing/extra/partial files, wrong fixture, payload/chain corruption, oversize
input or a poisoned report fail full readback. Earlier callbacks on a later
failure identify only a validated signed-intent prefix. They do not establish
submission, business execution or finality, and no identity is retried.

## Integration and verification status

The helper and focused test sources are complete and formatted. They are NOT
wired into live CLI/ready sender dispatch yet. The existing journal, driver
2,048-input/32-nonce limits and launch resource caps remain unchanged. This new
source is excluded from the fixed `45058e7f764529421870a5fc41264da86b9ab2a0`
eight-function CI delivery. Do not infer that its tests have executed.

Test sources cover six genuine fixture-signed inputs written as two waves and
streamed back byte-for-byte; exclusive directory reuse refusal; append after
close; partial and complete-but-uncertain persistence with no retry/counter
advance; missing/extra files, corruption, wrong fixture/final chain, budget
exhaustion and invalid signature in an otherwise hash-valid segment. These are
input evidence tests, not consensus acceptance.

Pending focused selectors for a later Root-approved validation, after the prior
fixed eight-function run has returned its resource slot:

```text
TestReadyIntentSegmentsPersistAndStreamExactSignedInputs
TestReadyIntentSegmentsNeverRetryFailedOrUncertainPersistence
TestReadyIntentSegmentsRejectMissingCorruptAndWrongBinding
```

Next: actual Go validation, then wire the existing controller's pre-submit
journal barrier and stopped readback to these same segments together. Only after
that can larger nonce/funding plans be introduced under measured capacity. A
larger record constant alone does not enable a ten-minute test.

## Fixed source delivery for current CI

Root authorized publication of the prior fixed source only. The original remote
ref was absent. Normal push of explicit commit 45058e7 completed with exit0;
subsequent `git ls-remote` read back
`refs/heads/codex/chain-performance-20261017` at exactly that full SHA. No mutable
intent-segment files were included. The Protocol candidate has no existing
`cmd/ynx-consensus-perf-client` package, so seven changed leaves cannot simply be
copied there. Root arranged an independent checkout of the exact original
performance source and its own go.mod/go.sum inside the existing correctness CI.
No production-tree merge, new workflow, N1 or network nodes is implied.

`evidence/client-focused-ci-freeze-45058e7-20261018.json` records exact before/after
leaf hashes, the source/base commit pins, the eight-function selector and the
observed missing target package. This is source availability; actual Go terminal
results remain pending the CI owner.
