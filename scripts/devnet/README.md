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

`pq-height-vectors.py` adds a NEW functional scope: replay the existing signed
corpus on each original Application source and collect intermediate heights
that frozen b6/aa never emitted. Neither old full-case results nor an old
baseline is renamed as per-height evidence. There is no signing/record mode.
The extra test is a separate overlay; the original preparation overlay and
frozen tools are unchanged. The initial record is the supplied original
`Initial` snapshot, not a claim to replay heights before that input boundary.

Each arm records all 32 authentic history blocks (16 Whole per block), plus
the complete 8 original or 4 multi-Whole candidate branches: 41 or 37 records
including Initial. Each includes exact transaction hashes, complete normal
Check/recheck/Prepare/Process/Finalize/Commit responses, full committed state,
accounts/balances/nonces, AppHash, Info and normal constructor cold reload.
Whole member outcomes must all be admitted. Branch ancestry and per-height
coordinates bind to the same original signed input. Constructor reload is
not a process restart/crash or cache-free timing result. No timings from this
functional run are used for performance claims.

For the sole CORE hosted job, use the SAME frozen tools version on both arms:

```sh
python3 -B "$TOOLS/scripts/loadtest/pq-height-vectors.py" prepare \
  --owner "$OWNER" --commit "$OWNER_SHA" --output "$RUNNER_TEMP/height-prepared"
python3 -B "$TOOLS/scripts/loadtest/pq-height-vectors.py" run \
  --prepared "$RUNNER_TEMP/height-prepared/height-prepared.json" \
  --input "$ORIGINAL_SIGNED_INPUT" --input-sha256 "$ORIGINAL_INPUT_SHA256" \
  --profile original --execute
python3 -B "$TOOLS/scripts/loadtest/pq-height-vectors.py" compare \
  --before "$BEFORE_HEIGHT_PUBLIC" --after "$AFTER_HEIGHT_PUBLIC" \
  --output "$NEW_HEIGHT_DIFF"
```

`--profile multi-whole` consumes the already signed multi-Whole input instead;
it never generates a replacement. Before replay here is explicitly needed to
collect previously absent vectors. Use fresh admitted original hosted jobs,
the same 2 CPU/4GiB/8GiB/900s limits, and always preserve partial public files
and first cause. CORE owns actual Application execution/CI; Root's four-scope
source workflow stays on its frozen b6/aa inputs. Tools do not dispatch jobs.
The new comparator checks all full canonical state bytes, all responses and
each cold observation; omitting an intermediate height fails even when the
last state is equal. Functional equality alone does not authorize optimized
pressure or qualify BFT/finality, throughput or network gains. New contract
controls are `test_pq_height_vectors.py`; fixtures are not Application runs.

Admission vectors preserve the original static committed-state semantics:
each Check/Recheck sees the SAME pre-state, so future-nonce Whole requests in
a 16-Whole block correctly return outer `CodeInvalidTx`, with the original
per-member nonce rejection data. The observer decodes original messages with
the normal codecs, binds their owner/nonces to committed accounts, and checks
the exact expected codes/outcomes/errors without mutating mempool/account
state. This metadata never substitutes for the normal CheckTx mathematics.
Prepare/Process still require the complete original ordered proposal; sequential
Finalize still requires every original business member admitted. The earlier
842 observer's blanket CheckTx-code-zero assumption is superseded; no successful
actual vectors from that defective observer are presumed or grandfathered.

RSS guard `same-process-rss-v2` preserves the real 41223769700 A first cause:
PID3702/startTicks19407 stayed R while leader `smaps_rollup` returned ESRCH.
The original six-attempt failure remains when no additional proof is available.
The successor first brackets a same-process task read with leader/member
startTicks and kernel Tgid/Pid checks. It counts one real shared-address-space
rollup, or an explicitly labelled positive kernel VmSize conservative upper
bound. Neither a thread's missing mm nor a multithreaded zombie leader is
counted as zero. Changed identities, permissions, missing proof and deadlines
remain fatal. Only a same-identity single-thread zombie or proved disappearance
qualifies as retired. No foreign process is signalled by this change.

The kernel documents [Tgid, VmSize and RSS semantics](https://docs.kernel.org/filesystems/proc.html),
including non-atomic/asynchronous process observations; the
[clone API](https://man7.org/linux/man-pages/man2/clone.2.html) requires shared VM
for a thread group. The VmSize bound is an accounting inference from total
mapped virtual size, not a precise RSS measurement or an interval peak proof.
Every fallback retains PID/TID/startTicks/kind/bytes/time/error in
`rssSamplingFallbackEvidence`; those samples remain charged to the SAME
aggregate 4GiB cap and can safely refuse an overestimate. No cap is relaxed.

The successful 9c22 before artifact13050898515 (41 vectors, original c819 input)
is retained. Guard-only compatibility requires that exact original tools pin,
the unchanged functional Go leaf SHA256
`3dda570d92374df2e66aaedadb35907354ec7073ac142fb72de67a16dd2ce0e0`,
an explicitly recorded v2 successor and identical original caps. All original
input, state, response, nonce, ancestor, cold and Go/CPU checks still run.
This narrow reuse is FUNCTIONAL only; `performanceComparisonQualified=false`
and pressure remains separately gated. Other tool/leaf/cap mismatches fail.
The Linux actual-owned-child task fallback control must execute in CORE's
normal job; local macOS skips are not Linux evidence. No before regeneration,
signature regeneration, old source-scope replay or new CI dispatch is done
by the guard tools.

Evidence sink `same-identity-first-last-count-v1` fixes the subsequent real
41226547284 A failure before Go: 4096 retirement observations represented only
16 distinct original identities/reasons. The compact regression fixture is
derived from original diagnostic13051019174; its unchanged original ZIP stays
at the owning CORE evidence path. The original raw diagnostic is not replaced.

Retirement aggregation keys are exact `(pid,startTicks,reason,rssError,statError)`;
fallback keys additionally include TID/thread start, sample kind and original
error. Missing fields, different identities or different reasons stay distinct.
Every observation retains its original first/last raw event, monotonic bounds
and exact decimal uint64 count. Fallback byte bounds retain min/max as well.
The original 4096 limit now bounds DISTINCT evidence rows; it is not increased.
Count overflow, clock regression and too many distinct rows remain fatal.
The sink never authorizes retirement and never short-circuits sampling: every
RSS/identity/exit check and every 4GiB resource comparison still runs.

Reuse the a786 real Linux guard controls from run41226547284 job124611786883
(33/33, zero skip; artifact13052310092 SHA256
`6ecf2298994054d786d6bb3a5e1077ff3ce6b9ee59f7357bd8c113d1f650f92a`).
Only the added `test_process_evidence.py` group needs the successor Linux job:
six tests including a real owned zombie repeatedly sampled before its actual
wait/reap. No old guard suite, before/B vector replay or source benchmark is
repeated solely for this receipt sink change. The original same-process RSS
algorithm, 3dda functional Go leaf, input and signatures remain unchanged.
The narrow 9c22 before functional compatibility still applies, without timing,
pressure or performance qualification. Successor receipts state both versions.

Guard `same-process-rss-v3-pidfd` addresses the later real 41228413687 A
Z/ESRCH failure (PID5403/startTicks49598), rather than guessing that a zombie
leader means every thread exited. After an original same-identity Z rollup
failure it opens `pidfd_open(pid,0)`, brackets that open with the original
leader startTicks and fdinfo PID binding, then polls for at most 20ms. Flags
deliberately exclude PIDFD_THREAD. As the [pidfd API documents](https://man7.org/linux/man-pages/man2/pidfd_open.2.html),
default process-pidfd readiness signals LAST-thread exit; a leader alone is
insufficient. Only that kernel group-exit proof permits retirement of a
multi-thread Z process. Descriptor errors/reuse/uncertain binding remain fatal
or unresolved, never RSS zero. The proof closes its descriptor and never
signals or consumes a wait/reap; normal parent/Popen ownership is unchanged.
At most six such bounded polls add <=120ms plus original retry sleeps/reads,
inside the unchanged operation deadline; elapsed time never proves exit.

If that pidfd is not ready, the original real same-group RSS/positive upper
bound path still runs; lacking either, the run still fails. Transitions now
retain thread count and the group-exit probe. Before/B41 reuse remains narrowly
functional with unchanged 3dda leaf and original caps, accepting explicit v2
or v3 guard successors; no timing or pressure qualification is extended.

Reuse the prior actual 33+6 Linux controls at their original source pins.
Only `test_linux_thread_group_exit.py` is the new affected group (six controls,
including real Linux raw leader-only SYS_exit with a still-live allocated
worker, followed by actual whole-group exit). No old source benchmark,
signature generation, before/B replay or large artifact download is required.
The new actual Linux counterexample remains NOT_RUN until CORE executes it.

The normal independent-load report also emits per-stage full-demand P50/P95/P99
from actual parent monotonic intervals. These stage percentiles remain null
unless ALL configured requests completed that stage interval; missing or
unreached work never becomes zero or disappears into a survivor-only P95.
Completed interval counts/totals/max and raw per-row timestamps remain available
when a percentile is unknown. Completing an early stage does not qualify a
failed transaction or supply a final-confirmation latency. This reporting-only
change does not alter the 4c14 guard or its pending Linux/height qualification.

Frozen LINK live adapter `0d0490055c57191f20ca2d3813bf6d4b6b5f37aa`
replaces the earlier layer-accounting copy byte-for-byte (SHA256
`1b9d16539b711ca7e490c8c4bc01984beba5efa474caeca187dee2f19a5e7635`).
The owned TCP module remains the unchanged 055 copy. The existing NetworkWindow
accepts an explicit `live_reader(node)->raw bytes` from the owning normal
private producer. Its call is bracketed with Python
`clock_gettime_ns(CLOCK_MONOTONIC)` and the exact original raw SHA; the frozen
`original_live_node_capture` performs schema/lifetime/generation/clock checks.
Same-kernel clock bounds are used for both outer checkpoints. No cached file,
after-stop lifetime value or alternative private transport is invented here.

CORE still owns the normal producer read transport and exact operator argv.
Until that callee is supplied and explicitly connected by the normal driver,
`originalLiveReadCalleeSupplied=false` and the missing layer reason remains
`normal_private_producer_read_callee_not_supplied`. Hook adapter checks are
not a live node/window test. Invalid bytes, oversize, read failure, stale clock,
changed lifetime or generation stay UNKNOWN. Disabled lossless and missing
proto remain null; the hook never enables either transport or metrics.

The actual current75 online run41264965296 failed before opening its load
clock: its fixed 16-owner persistent sender pool exceeded the inherited
`ownedProcesses=16` ownership inventory bound. Original logs show all builds,
activation and four live-policy setups completed, followed by sender startup;
this is a feeder process layout boundary, not measured chain saturation.
The old profile/partial artifacts remain unchanged and its 500 requests remain
unsubmitted/unqualified. Current75 includes earlier production optimization,
so it is never the historical fdc before or evidence of an fdc-to75 speedup.

The normal driver now records a necessary process lower bound before builds:
supervisor + four nodes + one persistent normal sender per online owner.
16 owners require at least21 PIDs and are refused against the unchanged16
limit. Root's explicit successor choice is eight independent accounts,
capacity63 each, with the SAME fixed500 requests / 5s /100 offered target.
That minimum is13 PIDs; transient helpers are still checked and may fail the
original dynamic bound. This is not an automatic account/rate reduction or a
guarantee of achieved throughput. Before/after comparisons must use the same
explicit account layout and other conditions. Missing/failed/UNKNOWN work stays
in the full denominator. No zombie exclusion, increased PID/RSS cap, new
signer implementation, changed crypto or replay of uncertain originals is used.

The same original failure exposed a cleanup defect: `Window.stop` hit the
ownership limit before signalling any original direct child. Its successor
retains the inventory error but always terminates/waits its own still-live
direct Popen children on that error path, closes its own logs, then rethrows
the failure. It does not select unknown descendants or claim complete cleanup
without the original inventory proof. Receipts retain
`directOwnedCleanupAfterFailure` alongside `cleanupComplete=false` and the
original cleanup error. The added `test_window_failure_cleanup.py` checks this
error path only; the real Linux group check is distinct from successful load
qualification. No original PID/RSS/CPU/storage cap or completed data is changed.

The eight-account successor also limits the complete transient normal-helper
lifecycle to three simultaneous children (or fewer if the original PID budget
requires). The same gate covers presigned lookup, live request/result and the
independent verifier; it does not remove any of the four original live lanes.
The exact current75 helper entry points contain no subprocess launches. Slots
remain occupied until their original Popen is known exited/reaped. On wait or
sampling failure the exact child is terminated/reaped before reuse; unresolved
cleanup retains a slot, sets cancellation, records debt and preserves the first
cause/UNKNOWN rather than starting another helper. Original limits and all500
requests remain unchanged. Existing stage intervals include helper backpressure.
The added control group uses actual local child processes to reproduce four
concurrent lanes, observes at most three live helpers, and covers cancellation
and failed-wait cleanup without producing any business/finality fixture:

```sh
python3 -B -m unittest discover -s scripts/loadtest -p test_pq_helper_lifecycle.py -v
```

Run41266674073 reached only the first build, not its load clock. A descendant
had six same-identity R/one-thread/ESRCH RSS failures. Its original500 requests
remain unsubmitted; cleanup completed with original build parent SIGTERM.
The v4 observer calls the existing process-wide, flags0, non-consuming pidfd
exit probe for any state after RSS failure, instead of restricting it to Z.
Only a real kernel exit event permits retirement; an unready/unavailable probe
still requires real same-group RSS or the original conservative VmSize bound,
otherwise it fails. No retry/cap expansion or live-R zero assumption is added.
The new `test_linux_running_exit.py` isolates this delta, including an actual
Linux kernel not-exited/exited pair while only displayed state is held at R.

Run41267267458 completed all three builds and opened the original eight normal
sender processes, then failed before the load clock: the online producer's
public manifest has `transactions: null` (originals are signed after claims),
while NormalBackend incorrectly tried to index it as a pre-signed corpus.
Backend construction now builds the nonce index only in pre-signed mode and
validates online null/empty metadata before opening sender handles. Online
sign/confirm callees, four live lanes, helper limit and full500 demand remain
unchanged. `test_pq_backend_modes.py` covers the original online-null/8-owner
shape, exact pre-signed indices/duplicate rejection, and wrong-mode refusal;
these are constructor controls, never business or finality receipts.

The complete independent normal call path is now:
original online-null construction -> exact FD3 sender canonical sign command ->
original public transaction bytes/hash checks -> one POST -> four original
hash-bound successful execution observations at H -> original status+ABCI Info
on all four nodes at least H+1 -> one serial live-materials request/result ->
pinned original offline transaction verifier -> original sender confirm ->
durable qualified receipt -> release that account's next nonce.

The H+1 readiness wait is required by the actual `capture` callee: it immediately
retires the lane UNKNOWN if H+1 is absent. It does not wait/retry that request.
The driver therefore waits BEFORE publication and records a separate
`successor_availability` stage and `successor-availability.json`. Readiness is
only a nonfinal height observation; all original proof/trust/confirm checks
remain mandatory. The bounded cutoff retains the submitted original UNKNOWN
without publication/replay. It does not require a quiet common checkpoint
while other accounts are executing. Signing still uses the original independent
committed checkpoint, and actual checkpoint races retain the normal refusal.

`test_pq_normal_callgraph.py` covers all-four engine/application readiness,
cancellation/foreign chain refusal, full adapter order, exact normal confirm
arguments, and rejection without qualified output. Proof checks are explicitly
intercepted in adapter-only controls: CONTROL_ONLY/failed-execution values are
ineligible for the business ledger and are never real business/finality proof.
Real first-to-all500 outcomes still come only from the sole CORE normal job.

The ready/timings adapter requires exact Go source
`7037966eb2ce7a7167f02a09ee1f3bc0eebd1026`. Its normal source qualification,
Go tree/fork graph and focused semantic checks must be supplied by CORE for
that source. An old7593 qualification cannot authorize it. Source703 includes
other production changes; these runs are not a pure static-cache A/B or an
old75 throughput ratio. Old eight UNKNOWN originals remain unchanged.

Measured sender processes now use the ORIGINAL `sender --ready --timings`.
The resource observer runs while all eight real opened/imported/leased DATA
handshakes are awaited, BEFORE the offered arrival clock. No sign/recover/
confirm command is sent to obtain readiness. Owner, plan/workload pins,
synthetic scope, no authority, no signature and no reserved nonce are checked;
raw ready JSON and parent/source initialization costs are retained. Initialization
has one bounded pool deadline; failure preserves full500 unstarted demand.
Moving initialization out of the clock is a measurement profile change, never
an asserted cryptographic speedup or a substitute for end-to-end confirmation.

Each sign/confirm reply and original live-materials setup/request/result uses
its actual703 timing fields. The original source `timings.stages` spans include
cold opening/KDF/import, checkpoint initial/current reads, dynamic node
validation, dual signing/self-verification/fsync, and policy/proof work where
supplied. Independent verifier elapsed remains the original parent stage.
`normalCalleeMeasurements` groups startup(8), setup(4), and each business phase
(500) separately, retains outcomes and cumulative cache snapshots per owner,
and never sums nested stages or startup echoes into business latency. Missing
or failed replies remain censored; a stage percentile is emitted only when
that stage is observed for the entire applicable denominator. Actual fixed
window TPS/inclusion/normal H/H+1/confirm accounting stays unchanged, including
the separate nonfinal H+1 availability gate from0e6. No PID/RSS/cap/crypto
parameters are changed.

Only the new adapter difference needs this control group:

```sh
python3 -I -B scripts/loadtest/test_pq_ready_metrics.py -v
```

These are public protocol/metrics adapter fixtures, not real custody, signature,
proof or business evidence. New source Go validation and actual500 outcomes
remain separate original CORE CI jobs. Existing39/41/cleanup/scheduler groups
are not repeated merely for the new handoff.

Directional hop readback reuses the frozen LINK TCP sampler and layer validator;
`--network-accounting` also retains `network-hop-accounting.json`. Each directed
owned P2P connection keeps its original PID/startTicks/netns, exact tuple,
socket inode/cookie, endpoint timestamps and counter source hashes. Hop totals
use **sender `bytesSent` only**. Reverse endpoint `bytesReceived` is a separate
cross-check, and retransmission counters are neither added nor subtracted.
These are whole-connection, matched-endpoint TCP counters across all P2P channels,
including any consensus/background work. Handshakes, sockets born and closed
between checkpoints, TCP/IP headers, link framing and exact transaction attribution
remain missing; loopback data is not physical wire or four physical hosts.

The full configured demand is retained. Only a completely qualified cohort with
its original offered+tail clock inside the capture bracket can expose a clearly
labelled matched-endpoint cohort ratio. It never becomes actual per-transaction
physical bytes. Missing/reset/reused/spliced counters stay UNKNOWN. In particular,
the57839-byte logical wire object is never used as a physical byte measurement.
No listener, packet capture, namespace change, privilege request or traffic is
started by the hop accountant. Controlled packet capture remains the original
network owner's separate permission/scope/evidence dependency.

Offline original artifacts can be read with `pq-hop-byte-accounting.py --account`:
pass `--binding`, `--start`, `--end`, `--receipt` as the original
`network-binding.json`, `network-start.json`, `network-end.json`, `receipt.json`,
the external SHA256 for each via its matching `--*-sha256`, and a fresh absolute
`--output`. Default mode is inert. New isolated controls only:

```sh
python3 -I -B scripts/loadtest/test_pq_hop_byte_accounting.py -v
```

These use UNIT counter vectors, not observed packet/business measurements.
Original proof/Commit groups need not be rerun for this independent accounting
change. Actual network snapshots still require the original owned Linux nodes;
absence of permissions/publishers never enables a fallback capture.

Optional `--header-hop-capture` requires `--network-accounting` and requests the
owned Linux header backend. It reuses the original frozen endpoint/PID/socket
scope; it does not start nodes or a new capture process. It refuses shared or
unproven namespaces, foreign/reused tuples, and absent CAP_NET_RAW. It never
enters a namespace, escalates privileges, enables promiscuous mode or widens a
filter on failure. The socket is created with protocol0 (no reception), then
an exact IPv4/TCP4-tuple cBPF filter is installed and locked before binding lo.
Only40 header bytes enter userspace. Kernel `MSG_TRUNC` supplies the original
IP datagram length; TCP options are length-accounted without reading payload.

`network-owned-header-original.pcap` retains the actual40-byte prefixes with
original IP lengths; `network-header-capture.json` retains scope, clock bounds,
limits, kernel drops and SHA256. Only outgoing copies enter per-hop IP totals;
receiver duplicates, SYN/FIN/RST/ACK-only events, payload lengths and original
TCP retransmission counters remain separate. Fixed limits are65536 outgoing
packets,256MiB outgoing IP bytes,120s,32 exact directed tuples; bound/drop/
identity failures preserve partial/UNKNOWN. These are kernel IPv4 observations,
not physical headers, hardware frames, exact per-tx attribution or proof/finality.
Loopback/GSO/GRO segmentation and pre-start/born-closed flows remain limitations.

The existing900s/4GiB/8GiB/owned-PID budget is unchanged. Capture bytes and its
one supervisor thread remain inside the normal supervisor accounting. Use the
same capture flags on both sides of a qualified comparison. On an unsupported
host or without the controlled namespace/permissions, save only the exact
unavailable reason; never substitute57839-wire objects or zero traffic.

Primary interface contracts: [Linux packet(7)](https://man7.org/linux/man-pages/man7/packet.7.html),
[Linux socket-filter documentation](https://docs.kernel.org/networking/filter.html).
Only this new feature's isolated offline/filter/permission controls are needed:

```sh
python3 -I -B scripts/loadtest/test_pq_owned_header_capture.py -v
```

The explicitly pinned c06 diagnostic baseline consumes
`pq-c06-source-qualification.py`: the two original whole CI runs plus the
original 10 top-level / 47 including subcase named-test supplement. The latter
job succeeded within an independently failed whole workflow; that failure is
preserved. The finite receiver checks the exact source/controller graph, closed
original ZIP, actual JSONL run/pass events and original CI identities again.
Its default import does no network, build, signing or load.

`fixtures/c06-functional-readback.json` records the original fresh 01a→c06 N=1
functional differential. PERF read 347 metadata/height originals (444289421
bytes), including both complete cold footers and identical per-height results.
It did not rehash CORE's 161 persistence CAS payload objects (about 4.97 GB).
Block-journal and atomic-json each completed 500 members over H4–66. Snapshot
completed 280 over H4–38, then both versions refused H39 at the original 32 MiB
ceiling. This diagnostic pair does not qualify any performance improvement pair;
`require_performance_pair` keeps that separate gate closed.

The retained consumer timings are actual *local functional* persistence spans,
not a four-process pressure measurement. Across 63 successful commits:
block-journal total 47.601 s (delta encoding 0.021 s, file sync 7.798 s,
journal maintenance 21.898 s, validation 16.945 s); atomic-json total 79.038 s
(JSON encoding 6.385 s, write 35.268 s, file sync 19.541 s, validation 16.573 s).
They suggest which spans to inspect next; no cross-layout speedup, business TPS
or finality claim follows from these sequential runs on a local external disk.

Optional `--owned-storage-accounting` uses the original supervisor only. It
stats the original plan's `home/data/blockstore.db`, `home/data/state.db` and
application state path before load and after original cleanup. It does not open
payloads or scan keys, HRS, config or consensus WAL. Each checkpoint has a shared
one-second sampling budget and bounded directory entries. Logical and allocated
filesystem-byte deltas can shrink during compaction and are not physical writes,
all storage growth or per-transaction bytes. Missing paths/unsupported allocation
remain UNKNOWN. Actual observer lifetime successes and retained durable sample
counts stay separate from the exact load-window Commit count, which remains
UNKNOWN without a matching before notification checkpoint. This adds no PID,
thread, namespace, privilege or separate window; all output remains inside the
original 8 GiB budget.

Full-cohort latency percentiles require all configured requests to supply that
interval. This includes the nearly complete 475/500 and 499/500 cases: their
P50/P95/P99 stay null with the original denominator and censored count retained.
The different interval start times make an observed-subset percentile insufficient
to identify the full-cohort percentile. The pure control
`IndependentLoadControls.test_nearly_complete500_still_censors_every_full_cohort_percentile`
checks both partial boundaries and the complete500 case without running a node.
This reporting fix does not alter or rerun an already frozen load window.

### Bounded staged normal-sender harness (execution qualification pending)

`--staged-publication` explicitly selects separate publication (2 workers),
inclusion/H+1 observation (2 workers), and normal final-proof/Confirm (4 workers)
queues. Publication admits a bounded four-entry queue; observation and proof
queues are bounded by the complete configured demand. The original Ledger still
owns one pending operation per account and advances its nonce only after the
original same-identity normal verifier and Confirm have succeeded. Different
accounts may continue publishing while proof workers wait. A blocked queue,
queued/unsent demand, inclusion alone or elapsed time cannot manufacture success.

The existing normal sender command opens one owner per process. The bounded
backend opens at most two cold signing processes, closes them by normal EOF after
the original reply, and reopens that same owner only to Confirm that original
operation. Closing a process does not release its logical pending operation or
remove its outbox. Confirm shares the original three proof-helper process slots;
parent + four nodes + two signers + three helpers is at most 10 of the unchanged
16 owned-PID cap. Cold custody import/DATA-ready, slot wait, launch, command and
normal-close elapsed times remain inside the reported operation. No warmed
ready replies are fabricated during preparation; no automatic re-sign or retry
is implemented. Source checkpoint movement can still produce the normal
rejection/UNKNOWN, which remains preserved.

Normal returned replies are counted before their timing/echo validation. Reports
separate actual missing timing on returned replies from unsubmitted or unfinished
demand and retain rejected outcomes and original causes. Full-demand requirements
remain unchanged. Events observed at/after the configured window+tail are retained
as `pipeline.lateEvidence`; they do not complete the cutoff cohort or release
its nonce. Source-side effects must later be reconciled against that same
operation. Actual parent cleanup cutoff time remains separately reported.

The staged source is explicitly pinned to
`c4b39c73ec3a43c2ba32f7071bb735b0c0447f5e`, tree
`2fd621242e73e1cb4901413c03f7d48336801d11`. CORE's normal sender now handles a pure
32 MiB cache-capacity refusal through the existing complete uncached loader,
without new flags or a larger cache. The new source's full normal CI and actual
500 independent initialized-owner input are still required:
`STAGED_SOURCE_QUALIFICATION=None` blocks staged `--execute` before source
probing, builds, nodes or keys. The older c06 diagnostic qualification is separate.
The qualified two-owner + 33 MiB control is not a 500-owner result. c06's intact
504-owner migration signature memo alone has a 54,918,864-byte lower bound, so
its 33,554,432-byte cached loader cannot supply that input. No Python codec,
truncated history, implicit smaller account pool or privilege change is used.

The original CI can invoke the new pure-control hook:

```
python3 -I -B scripts/loadtest/pq-staged-harness-controls.py --run
```

It declares 61 controls: completion/reporting 20, staged scheduler 16, bounded
normal sender transport/lease 19, owned namespace identity 4, and two affected
full-cohort/export-stage controls. These are pure transport/scheduling controls,
not Go cryptographic, node, pressure or performance evidence. In particular a
16-account case blocks all four final-proof workers while accounts 9–16 still
publish/observe, with zero qualified and all 16 pending/nonces retained. The
execution flag stays closed until the genuine new-source prerequisites arrive.

Header capture now derives namespace identity only from the actual original
launcher and registered PID/startTicks, never init PID1. It does not read foreign
process namespace links. If foreign visible processes prevent proving exclusive
controlled scope it refuses capture, retains the positive owned identities and
reports scope unproven. It does not infer their namespaces, switch namespaces,
raise privilege or capture an unrelated scope. The original run's EACCES remains
unchanged evidence.

The immutable c06 diagnostic run 41293628942 used 500 total demand: eight POSTs,
eight four-node execution observations, one original verified+Confirm qualified
receipt in tail, eight UNKNOWN rows (including the next sign with no reply), and
491 queued. Effective qualified business TPS in the five-second offered window
was zero. The eight POST→inclusion samples ranged 3.980934183–8.012486377 seconds;
the single POST→qualified receipt sample was 29.521133448 seconds. Full500
percentiles are censored. Four stopped Commit snapshots each retained seven
samples H15–21, including preparation/nonbusiness commits. The endpoint TCP sum
31,238,620 bytes is not a physical-wire or per-transaction measurement. This
single-host four-process diagnostic is neither a before/after improvement nor
four physical fault-domain validation. Its original ZIP and all 192 file hashes,
partial outcomes and first operational failure are preserved outside Git.

The staged driver also has `--initialization-only`, fixed to online 500 business
accounts plus the original four preparation accounts (`--rate 100 --seconds 5
--accounts 500 --per-account 1 --staged-publication`). It uses the exact c4b
source/tree and the pinned original source-functional named-case receipt. That
receipt is a prerequisite, not proof that 500 owners already initialized.
The normal create/bootstrap/registration/halt/activation/live-policy flow remains
unchanged, including the original reserved-account preparation traffic. After all
four normal nodes reach the original common initialized checkpoint, the driver
reads each original application snapshot once and matches every business account's
original address, nonce and balance. A missing account, changed snapshot, different
checkpoint, resource limit or cleanup debt fails the initialization DATA contract.
It never enters the 500-request business scheduler, sign/POST or proof queues.
The separate business-pressure qualification remains absent until actual complete
initialization evidence is reviewed; this flag does not authorize a pressure run.

`initializationStages` retains parent monotonic spans for the three builds, complete
owner creation, bootstrap/PQ starts, quiet waits, original command calls, reserved
preparation transfers, activation/live setup and full account census. Nested spans
are not additive and do not replace Go callee timings. `freshResourceAdmission`
records actual available memory/disk and conflicting heavy processes immediately
before the original admission guard; CPU2/RSS4GiB/900s/PID16/new8GiB remain fixed.
The original finally block stops/reaps owned processes and retains the complete
unreleased500 denominator. `test_pq_initialization_measurements.py` contains 16 pure
controls including the full mocked driver path; no Go, real nodes, signing or
performance execution is inferred from these controls.

Subsequent measurement tools preserve `initialization-events-*.jsonl` with the
original bounded, fsynced Journal. A request event has no fabricated elapsed time;
a missing return remains UNKNOWN. The request journal cost is retained separately
from the original method span, and containing parent spans still include nested
telemetry costs. A failed event write prevents initialization qualification; a
second journal failure cannot replace an earlier original operation failure.
This is a successor tool change and does not alter the frozen 1f4996d50 run.
The original reserved-account preparation sender now opts into the existing Go
`--timings` reply, retaining startup and nested checkpoint/static/sign spans
separately in `preparationSenderMeasurements`; the original FD3 command, key
opening time, request, nonce and result remain unchanged. The ordinary functional
Ceremony keeps its original default arguments.
The account census calls the existing original resource guard before each read,
while raw snapshot bytes are resident, after decoding while both representations
are resident, and before release. It uses no background thread or extra process,
so initialization's original fork/FD3 lifecycle stays intact. Reported RSS peaks
remain observed samples; they do not become continuous hardware measurements.

The failed 41303023201 initialization's exact public `live-setup-0` stderr is a
small regression fixture. The driver retains a separate closed failure-metric
record when the normal CLI exits with its original `YNX-PQ-LAB-CALLEE-FAILURE/v1`
telemetry. These nested elapsed spans remain failed/UNKNOWN observations; they
never increment successful reply coverage, grant authority or permit retry.
Missing, duplicate or relabelled failure metrics remain NOT_SUPPLIED, and any
telemetry-read error leaves the original Go/Python exception unchanged. The
frozen original receipt is never backfilled from successor measurement code.
