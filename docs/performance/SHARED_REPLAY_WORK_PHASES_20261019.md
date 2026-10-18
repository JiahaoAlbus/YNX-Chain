# Shared replay work measurements

Based on actual run39164390241: client decode cumulative5.431s included shared
flight wait2.685s, with6 full replays/14 joins/4 hits. Those counters did not reveal
producer versus copy/private JSON/full state validation costs. No optimization
benefit can be inferred by adding nested or parallel timers.

## Source change

On the existing explicit shared-replay/observer-timing path, bounded value counters
now record actual calls/errors/duration for `produce`, `canonicalCopy`,
`privateJSON`, `privateValidate`, plus cumulative `canonicalCopyBytes`. Original
`waitNs` remains separate. Copies retain the original ownership and lock scope.
Producer includes original journal decoding, signature/execution validation and
canonical encoding; it is not a pure signatureCPU counter. Private state still
runs original strict JSON and full Validate. Cancellation, first errors, per-store
fresh capture/hash, fee/nonce, transaction, publication/quorum and durability gates
are preserved. Non-shared default execution has no new phase recorder.

Stats snapshots contain fixed values rather than shared mutable maps. Recorded
bytes are cumulative copied work, not retained memory or an RSS bound. Wall times
include scheduling; recording overhead remains inside original outer measurements.

Current online controller execution with shared replay requires the new work
fields. Unknown/missing/malformed fields, negative/boolean values, impossible call
counts and inconsistent failure paths fail validation. Historical offline reports
retain their original schema and exact interpretation; they are not backfilled.

## Reproduction and focused validation

Base source d224e7babd595de6dedfb4dbad2ec43f4ad43e91. A real signed two-store
execution/readback RED case completed the original replay/business checks but
failed because work phases were absent. Original failure raw is retained and the
reconstructible patch is `evidence/shared-work-phases-red-d224.patch.json`.

Focused shared replay tests PASS0.952s, including real signed execution, unchanged
fee/nonce checks, changed/missing files, signature tamper, stale published info,
bad quorum, failed producers, cancellation, bounded retention and concurrent joins.
New checks retain private JSON and state-validation failures, avoid recording work
for pre-cancelled calls, and prove snapshots cannot mutate retained counters.

Controller60 tests PASS2.296s. Re-reading all2048 original fixture/results and
original receipt/node-phase facts from39164390241 produced exactly the same full
legacy readout after the optional-field validator change. Existing recipe pins and
original caps are retained. Tests are already selected by the original CI's
`TestSharedReplay.*` and controller commands; no independent replacement CI.

## Original2048 journal: separate local offline measurement

Recovered two previously unread original artifact12150277228 members with exact206
range/CRC/size/SHA checks: bound-migration847001B and node1 journal1717048B.
Journal SHA256 `7c2a5b38bdb057972462068772196e74e4ab5c8564712fea1f54a6e89bee4d0a`.

A bounded read-only Go test overlay created two fresh private copies with original
reader lease metadata; it did not change the downloaded input or production reader
checks. First fixture attempt omitted `.read.lock` and failed; that raw remains.
After correcting the fixture, one cold replay plus one private hit passed, with
original fee/nonce checks and canonical final-state SHA256 exactly matching the
original network receipt:
`67af2a5cdeeb6a0b5c4b9aa74bede75b3ed730e3e3f5828ac390f123149e9357`.

Actual local darwin/arm64, Go1.25.7, GOMAXPROCS1, one sample per path:

| Work | Calls | Elapsed ms |
| --- | ---: | ---: |
| Cold original full replay | 1 | 298.121 |
| Canonical byte copies | 2 | 0.368 |
| Private JSON reconstruction | 1 | 14.778 |
| Full private state validation | 1 | 4.698 |

Copied bytes5221666; canonical payload2610833B. Original journal replay processed
7 blocks/2048 transaction inputs and successfully verified2048 native signature
facts. Both offline transaction readback checks passed and both copied journals
remained byte-identical. No RPC, fresh quorum/publication proof, new transaction
execution, inclusion/finality latency or network TPS was measured by this probe.
Local hardware/one-sample conditions prohibit comparison as a Linux network gain.

This sample supports investigating repeated full journal replay before replacing
byte copies. The next implementation must inspect whether a fully validated prior
prefix can be reused while binding the exact freshly captured current bytes,
preserving independent state ownership and all new block/crypto/result validation.
No incremental replay shortcut is implemented or authorized for activation here.
Any runtime optimization still needs an actual same-condition before/after pair
and Root's resource window. Sustained1000 valid finals/s and ten minutes remain
unachieved.

Tracked source/RED/raw pins and actual outputs:
`evidence/shared-work-phases-source-local-actual.json`.
Raw inputs/probe/overlay/results:
`artifacts/chain-performance-20261017/shared-work-phases-source/`.
