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

Twelve Node tests pass, including actual CLI consumption of both receipt shapes,
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
