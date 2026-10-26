# Fresh four-node phase readback contract

This consumer is implemented in `scripts/loadtest/pq-fresh-phase-readback.mjs`.
It reads the original Protocol callee's `YNX-PQ-NETWORK-FRESH-PAIRED-BUSINESS/v1`
receipt, rather than requiring a separately invented producer format. Original
callee source inspected: `internal/consensus/pq_network_fresh_business_test.go`,
SHA256 `5b5cc231800157a2d4ac0ce07af43010c61ac18f9398e54711a18d6d9deb530f`.
The original owner must freeze and supply its tested protocol commit and actual
build manifest. This document does not authorize a node window.

## Normal entry

```sh
node scripts/loadtest/pq-fresh-phase-readback.mjs \
  --result /absolute/original-result.json \
  --guard /absolute/original-completed-guard.json \
  --expected /absolute/root-pinned-expected.json \
  --output /absolute/new-phase-summary.json
```

All inputs must be canonical absolute, bounded, protected regular files, without
symlinks or hardlinks. Output is new-only mode 0600, synced with its directory.
The consumer does not send transactions, start processes, or grant resources.
The original controller must supply the completed guard: `firstCause:null`,
`child.code:0` and `child.pid` matching the original phase-clock PID, `cleanupComplete:true`, the original `emptyOwnedScans` metadata records (at least two, bounded
monotonic `elapsedMs` and positive `hostIdentities`), exact protocol `sourceCommit`, and SHA256 of the original raw result
in `resultSHA256`. Do not invent a success guard for a failed or unfinished run.

External expected bindings are `protocolCommit`, `performanceClientCommit`,
`clientSourceTree`, `clientCodeTree`, `vmBootId`, `clockDomain`, `sameProcessPID`,
`businessPerArm:16`, distinct `epochs.before/after` genesis SHA256 values,
`verifierRole:"ynx-consensus-proof-verify"`, the three `sourceLeaves` SHA256
pins from the original build manifest, and `binaries` mapping the four original
ELF names to their SHA256 pins. The original result does not carry a boot ID or
client package subtree: these remain external runner bindings, not claims
verified from the receipt. No self-consistency hash establishes trust alone.

Required client source is commit
`70e7e450997a0ae77dbad5a8be3682f482c6ddd8`, full tree
`4866cc3924c060eb6a29939915d39b1c5c625607`, client package subtree
`19b9fafcfbb3f434b9ff745fb785afb1d0741247`.
Original chain-core CI now checks out that exact client commit separately for
Go 1.26.10 Linux/amd64 prebuild. `SOURCE.json` distinguishes the compiled
`commit` from the workflow's `producerCommit`; a current-HEAD binary must not
be relabeled as the frozen client. The normal source test job remains Go 1.25.

## Measured outputs

Numeric original parent-clock phase offsets are checked for safe integers and
the original 120-second bound before conversion to exact decimal durations.
No child monotonic origin is subtracted from the parent's origin.
Each business height must have exactly one Finalize and durable Commit sample
per node, with the original storage mode and encoding/write/fsync stages.
Per-node block samples are counted once per physical height, even when many
transactions share that block. Flat persistence stage totals cannot exceed
sample time; the difference from outer Commit remains separately visible.

Each arm reports sample counts and nearest-rank P50/P95/P99 for:

- offer to first node Finalize, first durable Commit and all-node durability;
- offer to completion of queued independent proof verification (an upper bound);
- the client's local submission-to-first-committed-RPC observation;
- all nine original client phases and five verifier phase/total durations,
  separately for submission and readback;
- per-node Finalize, outer Commit, persistence sample, unattributed outer Commit
  time, and every original persistence stage, including encoding and file sync.

Missing first-RPC observations remain missing. UNKNOWN may be reconciled by
original independent readback, without another submission. Registrations are
excluded; duplicate original effects do not increase business count. The
legacy normalized arithmetic fixture format is also supported, separately
identified in the summary.

The actual original Go receipt projects client fields and does not embed raw
verifier stdout. Its summary says `inputEvidence` is
`original-callee-projected-client-receipts`; `independentProofReverifiedHere`
is false. This is measurement data from the original qualified callee, not a
new cryptographic verifier or an authority decision. Raw verifier evidence
remains with the original client/callee. Proof completion includes queue time
and is not the instant of BFT formation. The small 2/s pair cannot qualify the
1000 TPS goal or its 10-minute sustained acceptance.

## Verification status

Eighteen Node tests pass, including actual CLI consumption of both receipt shapes,
immutable output and unchanged inputs, missing/unsafe numeric clocks, wrong
source and ELF pins, UNKNOWN, original hash binding, registration exclusion,
per-height deduplication, missing node/fsync and incomplete cleanup rejection.
These are arithmetic/contract tests, not signatures or four running nodes.
Raw output: `pq-fresh-original-phase-adapter-20261026.raw` under the existing
external chain-performance artifact directory. Original Go DATA tests and the
four-node pair remain the Protocol owner's normal build/run handoff.

The original controller emits metadata records, not empty arrays, for empty
owned-process scans. A real-format RED case was preserved and repaired in the
consumer. `cleanupComplete:true` is required: scan metadata alone cannot prove
cleanup. The consumer does not rewrite the original guard. The generic legacy
arithmetic fixture schema retains its distinct two-empty-array contract.

## Original stdout entry

The original compiled test emits its public result with the unique
`PQ_NETWORK_FRESH_BUSINESS_SUMMARY` marker. Use `--stdout /absolute/go.stdout.log`
in place of `--result` to consume that original log directly. This mode requires
the original guard's `stdoutSHA256`, a single actual RUN and PASS for
`TestPQNetworkFourValidatorFreshPairedBusinessAndPhaseTiming`, one marker from
the original source file between those events, terminal PASS, no FAIL/SKIP,
and all the same source/PID/cleanup/result checks. It does not synthesize
`resultSHA256` or rewrite a guard. Output records both the original stdout
SHA256 and SHA256 of the exact embedded JSON bytes, without reserialization.

The original controller still needs its owner to add/freeze the fresh profile
and run it under Root's resource schedule. A green legacy E2E window, old
result, pending build or this parser's fixture tests cannot substitute for that
actual fresh run. This consumer changes no controller or run authorization.

## Actual normal build handoff

Original push CI [40220335526](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/40220335526)
completed successfully at producer `da3060e150e2bd0f5695d67a76f3b30fafd1c696`.
The exact client compiled from `70e7e450997a0ae77dbad5a8be3682f482c6ddd8`
is now supplied, rather than merely planned. Artifact ID `12609705118`, archive
SHA256 `9746d58ff81522bf58fe92825f9202883e5db44e27c0ed8b523ec76054788eaf`;
its one download matched the original artifact API digest. The 38,595,797-byte
Linux/amd64 ELF SHA256 is
`a34a55a856e021c71565b1155b2767951e73147771841fc80f73f6e582a6edec`.
Its 708-byte SOURCE.json SHA256 is
`40aff3ccf799ae084897b37a9661c3e49914f9de13cc0cca8c94c158b6469ce9`.
Independent local `go version -m` readback of the ELF confirmed Go 1.26.10,
Linux/amd64, exact compiled VCS revision and `vcs.modified=false`; no Linux ELF
was executed on the Mac. File hashes/lengths and both source trees matched.

Machine-readable normal CI and artifact readback:
`evidence/pq-client70e7-ci40220335526-readback.json`.
Original archive, three extracted public files and READBACK.json remain in
`/Volumes/西部数据/YNX-large-work/chain-performance-20261017/pq-client70e7-ci40220335526`.
The subsequent original-cleanup and stdout consumer changes in `f63131613` and
`433481ab3` have 12 local tests passing and their own normal CI `40221098752`
in progress. They are not retroactively attributed to the completed producer.
The normal CI passed source checks under Go 1.25; the Go 1.26.10 gate builds the
frozen client. Neither gate is a fresh four-node run or sustained TPS evidence.

## Paired distribution differences

`pairedQuantileDeltas` reports observed after-minus-before differences for each
latency, physical node/block stage and original client/verifier stage. It keeps
both sample counts and whether they match. P50/P95/P99 retain before/after
nanoseconds and signed differences; relative percentages are exact rational
numerator/denominator values. Missing samples or missing stages produce null,
not zero; a zero baseline has no percentage ratio. A pair with different
persistence profiles is rejected, rather than presented as equal conditions.
The result is a difference between two observed distributions, not matched
per-transaction samples or proof that one change caused an improvement.

Submission clients in this callee do not invoke the independent verifier.
Their default zero fields now produce zero verifier execution samples and
`notInvokedSamples:16`, not sixteen artificial zero-duration verifications.
Readback verifier stage totals are checked against the original encompassing
total before quantiles are calculated. Original client fields can still contain
zero durations for unused client phases; these values are not extra RPC calls.
The original input reports and raw logs are retained for interpretation.

Fifteen contract/arithmetic/CLI tests pass, including changed/missing stages,
zero baselines, physical block counts, different storage profiles, uninvoked
verifiers and overlapping stage rejection. Raw output:
`pq-fresh-paired-phase-deltas-20261026.raw` in the existing external performance
artifact directory. These added tests generate no measured node result or
cryptographic finality claim.


## Exact bounded original result gate

The stdout consumer now matches the original caller's sole-test contract:
one exact fresh RUN, one exact fresh PASS, terminal PASS, no other RUN/PASS,
no FAIL/SKIP/panic/fatal record, and the source marker uses ordinary Go log
space/tab indentation. One final newline is accepted; diagnostics or extra
blank records after PASS are refused. The original projected public JSON is
bounded at 256 KiB, as in the frozen Go producer. The legacy arithmetic schema
keeps its separate existing bound. No caller, Node, grant or resource limit is
changed by these read-only checks.

The 16-test focused suite includes mixed-test logs, trailing diagnostics,
no-final-newline compatibility and oversized public-summary rejection. This
is a consumer contract gate, not independent cryptographic verification or a
four-node measurement. Raw output:
`pq-fresh-bounded-original-result-gate-20261026.raw` under the existing external
chain-performance directory. Validate the matching new original caller once
its complete supply/recipe/real outputs are handed over; do not launch another
driver or repeat the already verified public binary downloads.


## Original parent-clock flow and backlog

Each completed qualified arm now reports one-second buckets for original
coordinator dispatch, first-node execution completion, first-node durable
Commit and completion of the independent proof observation. Buckets use the
original parent clock and explicit durations; a partial last bucket has its
actual denominator. Internal boundaries are left-inclusive and the final
measurement endpoint is counted in the last bucket. Business events are
counted by unique original transaction identity; per-block persistence spans
remain counted once per physical node/height.

The offered-awaiting-first-durable and durable-awaiting-proof queues include
peak, final count and exact time-weighted mean as count-nanoseconds/window-ns.
Events at the same timestamp are applied together, preventing artificial
instantaneous peaks. The first queue area equals the sum of original
commit-minus-offer durations; the second equals proof-minus-commit durations.
These are observed queues, not measurements of when a BFT quorum first formed.
Distinct RPC acceptance time remains missing and accepted throughput is null.
Original reported offer lateness is retained with sample/missing counts.

Initial UNKNOWN and UNKNOWN before independent readback have separate counts
and exact fractions over all planned business identities. Independently
reconciled UNKNOWN remains one original operation, never another submission.
This report requires the complete qualified arm: aborted/failed windows remain
original guard failures, not a success report with zero errors. A small finite
pair still cannot qualify sustained 1000 TPS or ten-minute stability.

Twenty focused contract/arithmetic/CLI tests pass. New cases verify exact
queue areas by hand-derived expectations, cross-second boundaries, final
endpoints, missing acceptance, duplicate-readback deduplication and reconciled
UNKNOWN. Raw output is `pq-fresh-parent-clock-flow-and-backlog-20261026.raw` in
the existing external performance directory. No new producer fields, driver,
Node, resource grant or private key is introduced; this adds only analysis of
the original rows already emitted by the frozen callee.

### All-node durable completion within the original window

Each per-second bucket additionally counts `allNodesDurable`, the latest actual
Commit end among the four original node traces for that unique business hash.
`offeredAwaitingAllNodesDurable` reports its exact peak, window-end count and
time-weighted backlog. Proof completion is kept separate: a valid proof may be
observed before the slowest node finishes local persistence. No ordering between
proof observation and all-node completion is invented.

An all-node completion beyond the original measurement end remains outside
window throughput and is counted in `afterWindowEvents.allNodesDurable`; the
transaction stays in window-end all-node backlog. Its captured full latency
still contributes to the existing allNodesDurable quantiles. Completion exactly
at the final endpoint belongs to the last bucket. This is full-replica durability
observation, not earliest BFT formation or an independent acceptance timestamp.

The retained RED case found the missing all-node bucket field. The focused PASS
covers both exact endpoint and after-window slow-replica completion, including
proof completed earlier and exact backlog area. Raw evidence:
`/Volumes/西部数据/YNX-large-work/chain-performance-20261017/pq-fresh-all-node-flow-red.raw`
and `pq-fresh-all-node-flow-pass.raw`. All 19 tests pass in 388.459333 ms. No new
RPC, process, node invocation or workload is introduced by the consumer.

### Original c57 explicit progress spans

The normal callee now emits `PQ_NETWORK_FRESH_PROGRESS` begin/complete lines.
The existing successful guarded stdout path additionally returns `progressStages`
with each original arm/phase/node/business-index span and per-arm/phase/node
duration quantiles. Raw-file input or older stdout without events makes no
new progress timing claim; stdout without events returns null.

At most 1024 events are accepted, all from the original source log prefix,
inside sole RUN and summary, with offsets/durations <=120 seconds, exact
completion arithmetic, unique begin identities and no unfinished span on a
successful original test. The existing guard/result gates remain mandatory;
this does not admit a failed or timed-out run as qualified business measurement.
Parent/child stages and parallel proof clients may overlap. Span durations are
inclusive and are never summed to infer wall time, pure crypto time or BFT
formation. Stage labels describe the original calls, not independent authority.

A retained RED reproduced the missing span consumer. The 20-test PASS covers
nested timings and absence, malformed arithmetic, completion without begin,
duplicate identities, unfinished stages and out-of-bound offsets. Raw evidence
is `pq-fresh-c57-progress-{red,pass}.raw` under the existing WD performance root;
full focused PASS duration is 409.5085 ms. No node, new benchmark or RPC starts.

## Original validation and transaction diagnostics

Use the existing reader with `--diagnostic-stdout` instead of `--stdout` to retain
observations from an interrupted window. The same protected inputs, new-only
0600 output and file/directory sync apply. This entry always sets
`fullPairQualified:false`, `sustainedTPSQualified:false`, and
`independentProofReverifiedHere:false`. It cannot substitute for the successful
pair entry, which continues to reject failed guards and non-PASS stdout.

The external expected JSON must bind `stdoutSHA256`, `protocolCommit`,
`sameProcessPID`, `clockDomain`, the exact three `sourceLeaves`,
`consensusBinarySHA256`, and `validationPhaseMapping` in the pinned source order.
The original terminal guard must match source/PID, leaves and consensus ELF,
retain its actual firstCause/child code, and report completed cleanup with the
original empty scans. Do not add a made-up stdout hash or success state to it.
Other ELF/manifest/intake pins remain separate provenance obligations.

The original 2cf producer emits unprefixed `PQ_NETWORK_FRESH_COMMIT_OBSERVATION`,
`PQ_VALIDATE`, and `PQ_FRESH_TX` lines directly. The reader accepts only that
source format after the sole original RUN and before a summary or terminal
marker. Prefix plus JSON plus newline must fit 1024/512/512 bytes, with at most
384/384/32 respective records. Each physical Commit and validation is unique by
arm/node/height. Each callback retains distinct native/ABCI hashes and the
parent-process clock. Failed validation prefixes exclude unexecuted suffix slots
from samples. Hash document and encode/digest intervals are children of app_hash,
never additional partition work. Validation sum must fit the observed outer
validate timer when present; missing outer validate is permitted only for a
failed validation with failed Commit.

Output separates outer Commit, persistence stages including JSON/file sync,
34 validation phases, and hash children. Stage shares are exact sums of node
timers, not wall time or CPU percentages. Callback joins retain first observed
Finalize completion, first durable Commit and all-four durable completion.
Missing node observations produce null all-node latency and a missing-sample
count. Child first-RPC durations are retained in their own clock, not subtracted
from parent offsets. Callback observations do not reverify proofs here and are
not completed-pair/business-throughput credit. Earliest proposal arrival and BFT
formation remain unmeasured.

Actual original run40283157360 was consumed without another artifact GET, node
run or guard rewrite. All 157 comparisons to its retained original analysis and
seven original file pins passed. The readback retains before92/after68 Commit
observations and before16/after0 validated callback observations; failure remains
`105s active deadline`. The diagnostic/source/CLI negative cases are included
in the existing test file invoked by `chain-core.yml`; 24 focused local tests
passed. Tracked evidence:
`evidence/pq-fresh-2cf-diagnostic-consumer-readback.json`. These are reader/source
checks and actual prior-log readback, not a new throughput improvement claim.
