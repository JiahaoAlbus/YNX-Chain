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

The helper and focused test sources are complete and formatted. The subsequent integration adds an explicit `--segmented-intents` mode to the
existing CLI/controller and both stopped readback paths. The existing journal remains
the default. The driver
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

Next: actual Go validation of both the standalone helper and controller/readback
integration. Only after that can larger nonce/funding plans be introduced under
measured capacity. A
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

## Controller/readback integration

The explicit segmented mode requires ready-pool, terminal-stream and result-slot
reuse. Both journal implementations satisfy one internal append/close/byte-count
interface. The same existing pre-submit wave barrier waits for append success;
no segment is deferred beyond dispatch. The default flat journal behavior and
all actual workload/resource limits remain unchanged. The supply byte counter
includes per-wave segment header bytes in this mode; the format is explicit in
readySenders.intentSegments and comparisons must retain it.

Completed and partial stopped readers use one recorded-format selector. It
checks the fixed fixture-local directory, forbids mixed flat+segment evidence
and refuses absent/poisoned/escaped segment receipts. There is no automatic
fallback, resume or inferred unsubmitted status. If a process dies before it
writes a usable segment receipt, the files remain uncertain and this full
reader refuses them; a future prefix diagnostic must preserve that boundary.

New Go source tests extend the existing actual signed-transfer/execution/durable
restart test with the segmented barrier and exact input recovery. Another
controller test injects a partial actual file write returning io.ErrShortWrite
and requires zero dispatch/prepared/completed, zero successful intent bytes,
a poisoned report and retained evidence. Format-selection tests reject missing,
mixed, escaped and poisoned receipts; option validation refuses missing terminal
or slot evidence. Legacy format selection is also exercised by the existing
readback test. These Go tests remain unexecuted at this revision.

Additional next focused selectors:

```text
TestReadySenderSegmentedIntentBarrierAndRecovery
TestReadySenderSegmentedIntentFailureNeverSubmits
TestReadyIntentFormatSelectionRejectsMixedMissingAndEscapedReceipts
TestSegmentedIntentOptionsRequireBoundedEvidenceMode
```

The original frozen 45058e7 source and eight-function CI recipe stay unchanged.
The production owner's phase API has been read for integration planning, but
its new tests have not yet passed remotely; no new measured phase numbers or
N1/N16/N64 runtime is claimed.
