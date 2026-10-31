# devnet

This directory is part of the YNX Chain engineering surface. It is intentionally separated so runtime code, deployment assets, and review packages do not collapse into the website repository.

The source-only Linux normal-node cohort entry is
`scripts/loadtest/consensus-linux-cohort.py`. CORE owns intake into the original
workflow; PERF owns this harness. Run it in a dedicated GitHub hosted Linux job
after checkout and the candidate's normal Go/Node setup. Do not overlap builds
or other heavy commands in that job. The harness compiles the three normal
commands sequentially, then runs four `ynx-comet` processes with their original
in-process applications and independent genesis/migration pins.

```sh
python3 -B -m unittest discover -s scripts/loadtest -p test_consensus_linux_cohort.py -v
python3 -B scripts/loadtest/consensus-linux-cohort.py \
  --source "$GITHUB_WORKSPACE" --commit "$GITHUB_SHA" \
  --work-parent "$RUNNER_TEMP" --profile legacy-native --execute
```

Upload only `$RUNNER_TEMP/normal-cohort-*/public/` with the workflow's normal
`if: always()` artifact step, including when the command fails. Never upload
`.private/`: it contains disposable synthetic validator/sender keys, signing
state, node data and operation-local module/build caches. The receipt records
the source/fork tree, compiled binary digests, four PIDs, full planned cohort,
original client and readback outputs, sampled resources, process durations and
owned-process cleanup. Initial gates are actual Linux MemAvailable >=6GiB,
disk >=16GiB and no other observed heavy process. Limits are two CPU affinity
slots, sampled 4GiB owned RSS, sampled 8GiB new allocated data and 900 seconds
including cleanup; the original client remains bounded to 2048 requests/30s.

`legacy-native` is an explicit prerequisite profile: fresh smoke (8 requests)
and fixed-window cohort (128 requests) use independent synthetic networks.
They do not measure PQ consensus, physical Commit timestamps, authenticated
H/H+1 results, sustained capacity or four physical fault domains. Original
H/H+1 RPC material is retained as **unverified data** for the original CORE
verifier. `--profile pq-and` currently refuses before dispatch: CORE must supply
the normal fresh PQ fixture/operator inputs and compatible original client
H/H+1 verifier path. Do not substitute the in-process Go E2E or relabel the
legacy result. Commit-stage export also remains a normal node producer gap;
the harness reports actual process/operation times and original client stages.

The current-version **source baseline** is a separate opt-in path. It freezes
only the chosen owner's committed Go graph and adds entry observers through a
guarded Go overlay. It neither edits the owner checkout nor includes its
in-progress/untracked lab source. A dedicated hosted source job can run:

```sh
python3 -B scripts/loadtest/prepare-pq-baseline.py \
  --owner "$BASELINE_OWNER_CHECKOUT" --commit "$BASELINE_OWNER_SHA" \
  --output "$RUNNER_TEMP/current-baseline-source"
python3 -B scripts/loadtest/run-pq-baseline.py \
  --prepared "$RUNNER_TEMP/current-baseline-source/prepared.json" \
  --mode record --execute
```

CORE supplies the checkout at the exact declared baseline SHA; do not silently
replace it with a later integrated candidate. The first declared source is
`fdc08527514587d5756264e43ab63588791e189a`. Upload only
`$RUNNER_TEMP/pq-baseline-*/public/` on success **and failure**. The fixed matrix
uses authentic signed Whole history H=0/64/256/512, K=1/16, original CheckTx,
recheck, Prepare/ProcessProposal, FinalizeBlock, durable Commit and cold reopen.
Actual account distribution, protected Wallet online signing, engine votes,
mempool and per-hop byte counts remain `UNMEASURED` in this source-only result.
Entry counters report calls, inclusive time and exact known copied slice bytes;
unknown map/account allocator bytes are not fabricated. Parent phase time and
process allocation include diagnostic overhead; nested timers are not additive.

The first run retains its public signed input bundle. Later candidates must use
`--mode replay --input ORIGINAL_BUNDLE --input-sha256 EXACT_SHA256`, then
`compare-pq-baseline.py --before ORIGINAL_PUBLIC --after CANDIDATE_PUBLIC
--output NEW_RESULT`. This compares the **entire** committed state and exact
member results/AppHash, including fees, balances, nonce and history, without a
projection that discards differences. Source matrices never establish final
chain TPS or authorize skipping failure/competition/partition qualification.

Additional same-candidate coverage uses `run-pq-baseline.py --profile multi-whole`
with the existing `--prepared`, `--mode record|replay` and replay SHA pin. It runs
only `TestPQMultiWholeBaseline`: H0/H512 × WholeCount1/16, one member per Whole.
Record a NEW synthetic 528-Whole signed public corpus against the frozen
unoptimized source, then replay those exact bytes on the candidate. The original
512-history/eight-case corpus and receipt remain unchanged. Each phase uses the
same candidate order/height/time; complete CheckTx/recheck responses, full
Finalize response, member outcomes, after-state and cold restart are retained.
Original CheckTx sees committed state, so later nonces can have rejected members
there while the sequential candidate admits them; compare both original results,
never invent a cumulative mempool state or count rejected members as business.
The explicit Commit diagnostic includes all validation phase durations plus
hash-document/hash-encode-digest detail, with its same-attempt height and valid
flag, alongside JSON/write/fsync/rename timing. Entry observers separately expose
Finalize seal, full state validation and hash construction. Nested timings overlap.
When the candidate supplies `pq_proof_history.go`, exact guarded hooks also
record owned proof byte/result copies, delta publication, full materialization
and index build/advance. Original clone counters alone cannot demonstrate a
reduction in total copying; known backing bytes exclude AVL/map allocator costs.
Keep both sides on this exact diagnostic version; replay the old eight-case
decoder comparison with its original b6 tools so instrumentation is unchanged.
This is
additional source evidence; actual distribution and sustained chain remain
UNMEASURED. CORE owns the one hosted workflow intake; do not dispatch duplicates.

The real four-process PQ functional/proof entry consumes CORE helper commit
`a78803d31632a461df7f012e2c13e46f17c48e6d` or a descendant, with its original
normal node source. CORE must retain that ancestor in the CI checkout history:

```sh
python3 -B -m unittest discover -s scripts/loadtest -p test_pq_normal_process_lab.py -v
python3 -B scripts/loadtest/pq-normal-process-lab.py \
  --source "$GITHUB_WORKSPACE" --commit "$GITHUB_SHA" --mode pre-signed --execute
```

Use another dedicated hosted source job with the same resource admission and
limits as above; run the current-owner diagnostic baseline first. Upload only
`$RUNNER_TEMP/pq-normal-process-*/public/` on success or failure. It builds the
original helper/node/verifier, starts four normal bootstrap processes, obtains each
validator registration once at the actual common next height, posts its exact
ABCI bytes once and observes only the same hash thereafter. It uses the normal
future height-halt publisher, waits for all four original nodes to exit, invokes
activation once and resumes their exact Home/HRS/args with an inherited private
FD mapped to 3. No credential bytes enter argv, environment or public artifacts.
The mapping uses isolated Python descriptor syscalls and `execv` of the exact
normal binary/argv, including source descriptors above9. Run41207445495 exposed
Linux dash rejecting `3<&16` before the sender started; the real high-FD control
now verifies private delivery on3 and closure of the original source descriptor.
Current AppHash is compared with original ABCI Info; Comet status's latest header
AppHash is the previous application boundary and is not substituted.

Run `--mode online` in a separate fresh admitted job for the original protected
sender path. Modes are never pooled. Eight independent original synthetic owners
reserve four for preparation and four for functional transfers; each has one
outstanding operation, no batch wait and no replay of UNKNOWN. Before dispatch,
an immutable four-request plan retains the complete functional denominator.
Pre-signed requests select the exact current owner/nonce from the original
owner-major manifest. Online requests use the original credential-FD sender,
save originals once, and close functional pending operations only through its
normal independent-proof `confirm`; unresolved preparation operations remain.

After original H/H+1 observations, stop all four normal nodes, require identical
full committed-state file hashes, then invoke the original stopped-store
`export`, pinned `proof-context` and normal `ynx-consensus-proof-verify` CLI.
Qualify only successful original dual-hash transaction DATA, with nativeGrant
false. Original RPC observations are immutable and separately linked by SHA256.
Only public proof subtrees are uploaded, never custody, credentials, HRS or DBs.

The entry records parent-monotonic checkpoint wait, original sender dispatch,
broadcast round trip, all-node inclusion observation, successor availability,
stopped export, proof-context, verifier and online-confirm intervals. Dispatch
includes original CLI startup, validation and durable publication; it is not a
crypto-only timer. Inclusion is a polled upper bound, not a physical block clock.
Qualified return includes cohort completion, shutdown/export/verification and
is not continuous-load finality latency. Four successful functional proofs
cannot establish stable TPS, finality P95, byte saturation or independent fault
domains. Those four formal metrics remain UNMEASURED until the separately
scheduled same-condition sustained windows. Never repeat the ceremony after
UNKNOWN or manufacture trusted light blocks from RPC responses.

For the next isolated logical-wire observation window, explicitly append
`--wire-observation`. Default remains off, and the source must retain original
CLI ancestor `e3a7319267b4c48d3f9164d702a38a3c3ac51713`. CORE alone adds the
three `test_pq_wire_readback.py` controls to its owning job before this opt-in.
The harness appends only the original `--wire-observation-output` and
`--wire-observation-scope synthetic-loopback-lab/v1` arguments to each normal
node. Each bootstrap/PQ lifetime gets a distinct fresh file under
`public/node-wire/`; the original plan, configuration, genesis, operator pins,
credentials, signing, channel, and canonical transaction bytes remain pinned.

After normal cleanup, read back all eight original completed-call snapshots,
retain per-file SHA256, per-node exit codes and missing/invalid outputs, and
check attempts=queued+notQueued and CheckTx-return accounting. Each real built
binary SHA256 is also retained. These are cumulative per-node lifetime totals
including preparation/retries; no isolated business denominator or physical
socket/handshake/TCP-byte result is inferred. Readback completeness and clean
producer exits are separate fields; neither implies async admission, finality
or permission for network packing. Measurement errors leave raw files and
partial observations intact and do not erase independent functional proofs.
Run41209173671 did not enable the option; its green functional paths supply
no logical-wire baseline.

The independent single-transfer load entry is `pq-independent-load.py`. It
uses the original normal CORE continuous `live-materials setup/request/result`
callee, never a stopped exporter. Receive an exact clean CORE source containing
that callee; its uncommitted implementation is not runtime qualification. The
normal source build, registry/halt/activation and original pins remain in the
owning hosted job. Four preparation owners are reserved and never recycled into
the measured pool; their unresolved originals remain separate in the receipt.

The full workload-bound logical arrival plan is persisted before any measured
account signs. An independent monotonic arrival thread records actual releases
even while the controller is blocked in a durable journal write; these times
are never backdated to planned arrivals. A ready account reserves one nonce, uses its
original persistent normal sender (online) or normal corpus dispatcher
(pre-signed), posts the exact original once, observes its hash on four nodes,
uses one independently pinned owning-node live policy, runs the normal verifier
and original online `confirm`. Only that complete successful proof returns the
account to the pool. Each failed/UNKNOWN account retains its reservation and
originals for reconciliation; the controller never restarts it or re-signs.

```sh
python3 -B -m unittest discover -s scripts/loadtest -p test_pq_independent_load.py -v
python3 -B scripts/loadtest/pq-independent-load.py \
  --source "$GITHUB_WORKSPACE" --commit "$GITHUB_SHA" \
  --mode online --rate 100 --seconds "$PQ_WINDOW_SECONDS" \
  --accounts "$PQ_ACCOUNT_COUNT" --per-account "$PQ_ACCOUNT_CAPACITY" \
  --tail-seconds 30 --proof-timeout 30 --wire-observation --execute
```

CORE chooses and records the real account/process capacity within the original
2 CPU/4GiB RSS/8GiB new/900s admission. Current normal corpus aggregate limits
are 1024 pre-signed and 10000 online operations INCLUDING the four preparation
owners. The window must fit the complete demand; it is never shortened or
the rate lowered automatically. Each current online owner uses one normal
process; there is no invented low-memory multiplex signer. If enough original
processes cannot fit, preparation stops at the actual cap and records all
configured demand as unreleased/unsubmitted. A normal CORE multiplex callee
must be supplied before claiming a larger practical account pool. The source
and any separate tools checkout are counted, with overlaps removed.

Sampling and callee workers run outside the clock/controller thread. Worker
spawns use an isolated child applying the SAME CPU affinity and file limit
before `exec`, without a Python `preexec_fn` after threads start. The new Linux
control must actually execute in the original hosted job; a macOS skip is not
its validation. Claims/stages are fsynced into exclusive bounded journal
segments; uncertain writes never trigger a retry or overwrite.

Reports separate planned demand, actual release/lag, one POST attempt,
identity-bound source ACK/inclusion evidence, actual final receipts inside
the fixed window and tail, not-sent/failed/UNKNOWN, account and stage queues.
Source ACK is not finality. Missing outcomes censor the FULL-cohort percentiles
rather than disappear from the denominator. Cold signer/checkpoint time, live
proof queues/publisher/reader, normal verifier and confirm points are distinct;
completed per-transaction stage intervals and their totals retain IO/scheduling
overhead; an unresolved last interval is censored. Account queue and worker
queue time remain separate from normal callee time. The qualified
receipt time is an observed bound including original consumer overhead, not
physical Commit formation. Short finite windows do not qualify sustained TPS.

Run `--mode pre-signed` in its own fresh job. Higher levels 500/1000 require the
preceding level's exact result via `--prior-result`/`--prior-result-sha256`, same
source/mode, complete demand and successful original proofs, actual source
evidence, no growing outstanding backlog, and the existing receipt latency
targets. A cap, missing independent final proof, late feeder or unresolved
operation stops escalation. Original failures/artifacts remain retained.

Optional `--network-accounting` connects the original supervisor to the frozen
LINK `05500bd907375884a727161e73ba634f1c6e1a27` TCP/accounting modules. Their
two byte-identical module copies are hash checked before import; no transport,
metrics endpoint, packet capture or separate runner is enabled. The normal
live PQ children supply exact PID/startTicks, peer ID and original loopback
P2P endpoints. The original ownership guard remains inside the sampler.

`network-binding.json`, `network-start.json`, `network-end.json` and
`network-accounting.json` are retained under the SAME public artifacts and
referenced by the original run receipt. Start sampling precedes the load clock;
end sampling follows drain while original nodes and the resource observer are
still alive, before cleanup. Sampling duration is recorded. This bracket
includes drain/consumer overhead and is not an atomic exact offered-window
counter. Keep this flag and all sampling conditions identical on both sides
of a future comparison; an old run without counters is not its byte baseline.

Current WireObserver output is after-stop lifetime only, and no normal live
lossless or original Prometheus endpoint is supplied. Those window layers
stay missing/UNKNOWN; after-stop lifetime values are not inserted into live
checkpoints. TCP endpoint observations retain closed/missing/reused/reset
states and incomplete coverage. TCP, queued proto, attempted and logical
counts are not added together; physical bytes, delivery and gains remain
unmeasured/unqualified. `qualifiedCountEvidence` comes only from the normal
load result, never the network counters. Import/accounting controls do not
execute or qualify the real Linux sampler.

