# Independent Linux Supply measurement

This extends the original Chain Core CI and reuses the native `/proc` helpers
from `scripts/loadtest/pq-paired-linux-window.py` without changing that file or
its caps. Root authorized source and refusal tests on 2026-10-18, **not a network
START**. Keep `workflow_dispatch.run_linux_supply=false` until Root schedules
one exact source revision. No new thread, framework, public chain, real account,
deployment, or change to the frozen Darwin cases is involved.

## Fixed case

`supply-256x4`: 256 new ephemeral accounts, four nonce cycles, 1024 signed business
transactions, configured offer rate 512/s, four submission workers and four
observers, ready-pool scheduling and block-scan discovery. Existing client code
performs actual signature validation, fee/nonce state readback, transaction Merkle
proof, weighted BFT quorum, durable journal and application publication checks.
One in-flight nonce per account and failed/UNKNOWN quarantine remain unchanged.

Default invocation only prints the recipe:

```sh
python3 -B scripts/loadtest/supply-linux-window.py
python3 -B scripts/loadtest/test_supply_linux_window.py -v
```

The original CI runs source-only refusal tests normally. After all existing
release/security gates, **only an explicitly scheduled true input** selects:

1. Actual Linux amd64 `/proc` preflight, with no node or build started.
2. The original Go 1.25 serial build path (`-p 1`, CGO disabled), producing four
   native ELF executables outside the checkout. Builds precede the runtime window.
3. Clean source/ELF/Go target/VCS/Comet module identity checks; native procfs,
   subreaper and fresh resource admission checks.
4. Exclusive private fixture generation, four ABCI and four Comet nodes, bounded
   readiness at height two, client execution, full closure cleanup and node phase
   parser. Every configured endpoint must be numeric loopback; redirects and
   proxies are disabled for readiness requests.

## Admission and limits

Actual Linux MemAvailable must remain at least 1 GiB + 128 MiB. Runtime sampled
owned RSS <=1 GiB, threads <=320, private data <=32 MiB, combined child logs
<=1 MiB. At most nine concurrent children plus their wrapper; complete PPID and
subreaper-adopted closure is monitored using PID startTicks. Disk/build floors
reuse the existing native monitor: free disk >=1 GiB +425 MiB, with additional
1 GiB compile and32 MiB data reserves at initial admission; build size <=1 GiB.
Source/build/private data share the monitored filesystem. Active runtime <=45s,
cleanup <=15s, complete receipt <=60s. Sampling is not a hard cgroup ceiling and
does not provide an atomic host snapshot. Native telemetry failures fail closed.

Linux MemAvailable **is not macOS pressure level1**. This independent environment
cannot establish a same-condition multiplier against the old Darwin observations.
The Mac frozen client, node binaries, Root pressure gate and pending cases remain
unchanged.

## Required evidence

`linux-supply-<commit>` retains the recipe, native preflight, actual receipt and
complete private case including failure logs and raw transaction results. The
receipt binds source/tree/internal identity, binary SHA256/build info, hardware,
kernel samples, child commands/PIDs, firstCause, cleanup result and timeline.
Per-transaction checks corroborate all1024 successful qualified final results;
zero CheckTx rejection, failed execution, UNKNOWN, timeout or missing submission
is required. Transient RPC observation errors remain in raw client evidence.

Supply counters cover actual completion wait, offer decode, pacing, dispatch,
successor signing/encoding and durable signed-journal append. Initial256 signatures
precede the workload and are excluded from successor signing: expect768 signed
successors but1024 durable journal envelopes. Terminal sink is disabled in this
finite profile, so its attempts/time must be zero. Journal append includes encode,
write and Sync, rather than pure disk I/O. Stage sums can overlap and are not BFT
latency components that can simply be added.

Four complete node timing sessions must pass the existing parser, including
shutdown, actual Commit validation/encoding/write/file-sync and other durable
subphases. Client raw results separately retain offered/submitted/accepted,
effective inclusion and qualified final rates plus P50/P95/P99 inclusion and
confirmation latency. A finite1024 transaction case **does not prove sustained
1000 TPS or ten-minute capacity**. Actual Linux execution is still unverified
until Root grants and this case executes.

## First actual socket case and next controlled difference

Run39132052058 at `cd6b075d35e1beabc57656c808a099e4205ed54c` actually started
the private four nodes on Linux4CPU, then failed at the unchanged10s client
deadline. It offered990, submitted819, accepted815 and qualified734 final
business transactions. Four submissions remain UNKNOWN,81 observations timed
out and205 were not submitted; no CheckTx business rejection or failed execution
was observed. The workload is **not qualified**. Runtime12.137s, cleanup complete;
peak RSS500125696bytes,61threads,16183702private bytes. Preserve all failed raw
results and do not retry UNKNOWN transactions.

Actual cumulative Supply durations: completion wait6942.104ms, pacing2705.992ms,
successor signing57.386ms, encoding110.027ms, offer decode8.133ms,
journal append107.572ms, dispatch0.119ms. These scopes do not define independent
additive consensus latency. Client RPC CheckTx response P50/P95/P99 is
41.871/106.843/151.864ms, while actual node CheckTx handler means are
0.133–0.135ms. Each node committed12blocks: mean Commit2.576–2.798ms;
cumulative validation19.140–21.591ms, delta encoding0.401–0.532ms,
write0.497–0.627ms and file Sync7.612–9.925ms per node.

For the734 completed transactions, inclusion P50/P95/P99 is
1082.379/1583.132/1698.344ms and confirmation from submission is
1168.187/1655.712/1747.284ms. Including the actual offer-to-submission queue,
offer-to-final is2645.577/3584.029/3627.250ms. These are censored completed-only
samples: incomplete/UNKNOWN results prevent an overall latency qualification.
See `evidence/linux-supply-socket-ci-39132052058-actual.json` for source identities,
all phase totals, raw member hashes and limits.

The pinned CometBFT0.38.23 `abci/client/socket_client.go` has a20ms flush timer;
the gRPC client calls CheckTx directly. This is a hypothesis for the measured
RPC/handler gap, not proven causality. Existing production `ynx-abci -transport`
and Comet `--abci` already support gRPC, so the next prepared difference is
`linux_supply_transport=grpc` (choice, socket remains default). Profile
`supply-256x4-grpc` preserves the exact workload, four submit workers, client10s
deadline, consensus timeouts, business/safety checks and resource caps. Both
server commands must select the same transport. No shared runtime code or Mac
case changes. The failure path now retains explicitly unqualified partial Supply
and prints firstCause/cleanup to CI stdout so artifact download latency cannot
hide the initial diagnosis.

New source tests cover paired transport selection and preserving failed partial
results without qualifying them. The normal original Go phase-test gate also
covers `TestABCITransportConcurrentAdmissionAndDurability`: real socket/gRPC
wire admission with16 concurrent valid/invalid calls,
unchanged committed state, signed execution, durable Commit/reopen, nonce replay
rejection and exact journal bytes across transports. Until that test executes in
CI, its result is unverified. A second four-node gRPC case still needs a fresh
Root grant at its exact source SHA; do not auto-dispatch or extend deadlines.

CI39133355591 at6a8221aa9 exposed a real startup RED before any second network
case: the gRPC subtest blocked in `grpcClient.OnStart`/initial Echo and the package
hit its10minute default timeout. Original failed stack is retained under
`artifacts/chain-performance-20261017/linux-supply-source-20261018/transport-ci39133355591-failed.raw`.
The supplied `tcp://127.0.0.1:port` is a server listen URI, whereas the pinned
gRPC `NewClient` uses DNS target resolution. The minimal correction preserves
the server listen URI and supplies numeric `127.0.0.1:port` to the gRPC client;
the four-node Comet command selects this via `--proxy_app` only for gRPC.
The corrected wire test has a5s startup context bound, retains the real signature,
commit and recovery assertions, and executes once in the original full ABCI
package gate. The later original phase-test selector is unchanged. This fix is
not verified until the new CI actually executes it; no second network START.

## Verified gRPC execution

Correction615a9323e passed normal CI39134864620, including the real transport
concurrency/recovery test. Root then explicitly scheduled one gRPC case at that
exact source. Run39135113804 actually completed SUCCESS: all1024 transactions
were offered, submitted, accepted, effectively included and quorum/durable-business
qualified final, with0 UNKNOWN, timeout, missing submission, CheckTx rejection or
execution failure. FirstCause is null and the owned process closure was cleaned.
The7993 recorded observation errors were all `block_scan_wait: block inclusion
not observed yet`; this is not a zero-error RPC history.

Workload6.664903s, full-window effective inclusion and qualified final153.640648/s,
actual offer184.575299/s versus configured512/s. Steady-state TPS remains null;
this is a finite1024 transaction success, **not sustained1000TPS**.

| Actual measurement | P50 ms | P95 ms | P99 ms |
|---|---:|---:|---:|
| Submission queue |0.018845|1.854397|22.903963|
| RPC CheckTx response |0.749330|20.200675|58.621731|
| Effective business inclusion |999.820678|1390.828249|1500.977072|
| Submission to qualified final |1189.716864|1541.218294|1591.893938|
| Offer to qualified final |1190.449749|1541.235637|1591.921950|

Supply cumulative durations: completion wait2849.674ms, pacing3529.947ms,
successor signing83.213ms/768, encoding157.367ms, offer decode14.981ms,
journal append21.604ms/22calls and1024durable envelopes, dispatch0.374ms.
Completion wait includes final drain; it is not independently measured nonce or
consensus latency. Each node recorded9 durable Commits, mean4.055–4.955ms;
per-node cumulative validation29.324–33.872ms, delta encoding0.645–0.827ms,
write0.802–1.014ms and file Sync4.287–7.891ms. Runtime9.024s, cleanup complete,
peak RSS562790400bytes,62threads,19794811private bytes.

Hardware **differs**: socket used Intel Xeon6973P-C4CPU, gRPC used AMD EPYC7763
4CPU. Both used Go1.25.14 and identical application internal treecfbd76d5, with
the same workload policy, workers, timeouts and resource limits. Report these
observations independently; no causal transport speedup multiplier is justified.
The complete receipt and member hashes are in
`evidence/linux-supply-grpc-ci-39135113804-actual.json`; full ZIP was not downloaded
or hash-verified, but each recovered evidence member has exact206/header/size/CRC
verification and its own SHA256.

The next useful workload change is to test the ready-account supply limit with
the already planned512accounts×2rounds, keeping1024total/512configured rate and
all existing caps. It requires its own fixed-profile guards and Root schedule;
it was not implemented or launched at receipt commit101b83fe7. For a strict transport
comparison, both transports must execute on the same actual runner with otherwise
matched settings; the two completed runs do not provide that evidence. Preserve
both existing cases rather than silently substituting them as matched results.

## Fixed512x2 source preparation

The next source revision adds only the fixed `supply-512x2` profile, explicitly
gRPC only. It keeps1024 total, configured512/s,4submit/4observe,10s client,
45+15s and all existing resource, signature, nonce, fee, proof and persistence
checks. Unknown names,512x4,1024x2 or512x2/socket are rejected; there is no arbitrary
account/round/cap input. Expected successor signatures are512, while all1024
envelopes must still be durably journaled. The workflow choice
`linux_supply_profile` defaults to the original256x4; execution remains
`run_linux_supply=false` unless Root schedules the exact new source revision.

Source-only preparation:

```sh
python3 -B scripts/loadtest/supply-linux-window.py --transport grpc --profile supply-512x2
python3 -B scripts/loadtest/test_supply_linux_window.py -v
```

The client now preserves its original `completionWaitAttempts/Ns` and partitions
those exact same measured samples by the controller state at entry:

- `completionSupplyWait*`: no ready account, with unoffered workload remaining.
- `completionDrainWait*`: all workload already offered, waiting for terminal events.
- `completionFailureWait*`: closed/error cleanup waits, distinct from either above.

Counts and nanoseconds must sum exactly to the original completion totals; failure
wait must be zero for a qualified case. Supply wait still includes submission and
observation completion dependencies; it is not a pure nonce or BFT timer. A deadline
that occurs during a wait does not change its original entry classification.

Pacing adds future-target vs already-due counts, the cumulative positive remaining
time immediately before `waitUntil`, and cumulative/maximum lateness upon successful
wakes for future targets only. Already-due targets are excluded from wake lateness
because signing/journal work may have made them late before waiting. These scopes
include wrapper and scheduler overhead and do not isolate kernel timer overhead.
They overlap the existing pacing duration and must not be added to it.

The existing six-real-signed-transfer controller regression independently holds
an initial completion and the last generation, checks separate supply/drain coverage,
all timing partitions, zero failure wait, original fast-before-slow behavior and
unchanged persistent restart/nonce checks. No signature, execution, finality gate,
durable-before-dispatch barrier, pacing interval, catch-up-burst restriction or
worker/queue budget is changed. Until the new CI executes this revision, new Go
partition assertions are unverified. This section authorizes no new network case.

## Actual512x2 and bounded cadence candidate

Root scheduled b5ee43175 once: run39136701047 completed SUCCESS with all1024
transactions accepted, effectively included and qualified final; zero UNKNOWN,
timeout, missing submission, CheckTx rejection or failed execution. Runtime8.552s,
cleanup complete, full workload6.117692551s, effective/final167.3833707/s versus
configured512/s; actual offered214.5008127/s. Inclusion P50/P95/P99 is
1045.470330/1452.402900/1652.136777ms; offer-to-final is
1260.528546/1606.583772/1745.046004ms. All7022 observation errors are pending
`block_scan_wait`, retained in the raw report. This finite case is not1000TPS.

The actual wait partition is decisive: supply wait0, failure wait0, final drain
1346.192240ms. Pacing wait4494.919199ms, positive target remaining1955.254813ms,
successful future-wake lateness2539.657031ms, maximum61.774800ms. That lateness
includes Go scheduling/wrapper overhead, not only OS timer latency. Signature
time64.186ms, encoding143.134ms and journal append44.248ms are smaller here.
Four nodes each completed8durable Commits, mean4.715–6.677ms. Peak RSS566603776B,
62threads,20670276private bytes. CPU AMD EPYC7763/4CPU and Go1.25.14 match the
prior gRPC model/compiler, but actual VM, account shape and client instrumentation
differ: no pure-code causal multiplier. Full evidence:
`evidence/linux-supply-512x2-ci-39136701047-actual.json`.

An opt-in `bounded-cadence` candidate now targets that measured wake drift.
`relative` remains the original default `now+interval` policy. The new mode
advances from the previous target through short jitter, permitting no more than
three immediately due successor targets (four offers including the late waking
offer). Lag >=4intervals or exhaustion of that consecutive-target budget resets
the next target to `now+interval`; missed slots from long pauses are dropped.
No transaction is retried, skipped into an effective count, or re-signed because
of the timer. Existing signed-journal barriers, one in-flight nonce, worker/queue
limits, submission hash checks, BFT/Merkle/fee/nonce and durable-publication gates
remain in the same production paths.

The CLI records `pacingMode`, catch-up target decisions, cadence resets and peak
consecutive catch-up targets. The wrapper requires the selected mode to match
the actual report and peak <=3successor targets; relative-mode counters must be0.
Only explicit512x2/gRPC accepts the new mode. The original workflow adds the choice
`linux_supply_pacing`, default `relative`; `run_linux_supply` stays defaultfalse.
Prepare-only example, **not a START authorization**:

```sh
python3 -B scripts/loadtest/supply-linux-window.py --transport grpc --profile supply-512x2 --pacing bounded-cadence
```

Virtual-clock tests cover the repeated2.5ms wake-jitter schedule counterexample,
exact unchanged relative scheduling, long-stall reset, independent four-offer
budget, unknown/overflow plan rejection and opt-in scope. These are scheduling
correctness tests, not simulated capacity evidence. The original six-real-signed
execution/persistent-restart/slow-peer regression also runs the candidate mode.
All new Go tests are selected by the original CI ready-sender gate; their result
and network effect remain unverified until actual execution. This candidate does
not authorize an additional network run or extend the current resource caps.

## Same-VM fixed pair preparation

The candidate's normal CI39137886641 at a8c2091c6 completed SUCCESS, including all
four virtual-clock schedule tests and the actual six-signed-transaction candidate
branch. That proves source/scheduling correctness only. Root then selected a
same-VM fixed pair for **source and CI preparation**, not network execution.

The original workflow adds `paired-relative-bounded` to `linux_supply_pacing`.
With `run_linux_supply=false` by default, this choice starts nothing. An eventual
explicit Root grant must select the exact new commit and inputs:
`run_linux_supply=true`, `linux_supply_transport=grpc`,
`linux_supply_profile=supply-512x2`, `linux_supply_pacing=paired-relative-bounded`;
all other booleans false. Four native ELF binaries are compiled once after the
original gates/preflight, before the pair runtime starts.

```sh
python3 -B scripts/loadtest/supply-linux-window.py --prepare-pair --transport grpc --profile supply-512x2
```

The pair invokes the same original `run` function twice in one native Python
process, on the same actual VM, in fixed order relative→bounded-cadence. It uses
two exclusive fresh fixtures with matched generation policy, same compiled ELF
files, same1024total/512configured/4submit4observe/10s/ABCIgRPC conditions. The
first case must finish all original business checks with no UNKNOWN/timeout or
missing transaction and actual cleanup complete. Two fresh `/proc` owned-closure
scans must contain only the launcher. Any first-case failure, unknown outcome or
unclean closure stops the pair: never start the second, retry, pick a better
sample, or reuse a nonce. Before second admission, all four binary hashes and host
identity are rechecked; final source/tree/compiler/environment/binary identities
must match across the two actual receipts.

Each case retains45s active+15s cleanup maximum, owned RSS1GiB,320threads,
9children+the wrapper,32MiB private data and1MiB logs. **Entire pair** budget is
120s with aggregate retained64MiB and logs2MiB; single shared build limit remains
1GiB and actual Linux MemAvailable floor remains1GiB+128MiB. Original native
RSS/memory/disk/identity guards also sample the pair wrapper between cases and
while preserving receipts. The pair adds a120s outer watchdog and reserves time
for cleanup and metadata; remaining global time can shorten second admission,
never extend either case. Combined retained bytes include both private cases and
the evidence directory, including actual receipts.

Both case wrappers, their raw receipt writes/fsync, the empty-closure checks and
the pair receipt write/fsync are included in that global window. Per-case actual
invocation wall time including receipt fsync must also be <=60s. The pair receipt
records completed-case facts, actual bootID/PIDnamespace/launcher, fixed order,
binary/source/compiler identities, resource samples, firstCause and raw member
SHA256s. Its `casesQualified` field is **not terminal pair PASS**: the final
`YNX_SUPPLY_PAIR_TERMINAL` stdout verdict is emitted only after pair receipt fsync
and the final combined budget check, and requires exit0. Receipt fsync or final
budget failure rejects the pair even if both case business counters succeeded.
Native telemetry remains sampled, not a hard cgroup memory guarantee; any
telemetry, cleanup, deadline or I/O failure keeps the case/pair unqualified.

New source-only counterexamples cover fixed/default preparation, combined retained
and unchanged build limits, total deadline, unexpected owned child, first-case
failure/UNKNOWN/unclean stop, changed binary before second admission, serial order
and rejection after final fsync. Synthetic orchestration tests launch no fixture
or node and provide no capacity evidence. Actual paired network execution still
requires a new Root grant after this exact source's normal CI succeeds. Record
startup order and random fixture/cold-start differences; report finite paired
observations, not sustained1000TPS or a generalized speedup.

## First pair guard RED and correction

Root granted ca4b5d75e once. Actual run39140104063 failed in its first relative
case after node startup: the pair resource guard recursively counted every
`*.log` below the private fixture, including Comet LevelDB blockstore/state/tx_index
WAL, against the2MiB **process stdout/stderr** cap. The recovered ZIP inventory
shows109719bytes of direct child stdout/stderr and2865404bytes of database WAL;
the first case's sampled private data peaked7314430bytes, below its32MiB cap.
The first case cleanup completed (elapsed3855ms), the second was never started,
and the post-fsync terminal verdict was qualifiedfalse at3893ms. No throughput
comparison or candidate effect was established. Full original failure is preserved
in `evidence/pacing-pair-ci-39140104063-failed.json` and its raw member hashes.

Correction: aggregate **process output logs** use only `*.log` directly under
the two fixed case roots, matching the original per-case log guard. Every nested
database/WAL byte still counts in per-case32MiB and aggregate64MiB retained-data
limits; no cleanup, cap increase, logging suppression or data deletion is involved.
Separate failure messages identify data versus process-log cap failures.

A counterexample places3MiB of nested database WAL beside1KiB of process output:
the exact ca4b old code gives the preserved expected RED, the corrected code
charges the WAL to data and passes. Adding2MiB of real process output in the
second case still fails the unchanged aggregate stdout/stderr cap. The25-source-test
suite passes locally; the corrected source must pass normal CI and receive a
fresh single Root grant before any new pair execution. The original consumed
grant does not authorize a retry.

## Actual same-VM finite pair

After correction50588f3e5 passed normalCI39140684817, Root explicitly granted a
new single pair. Run39140997118 completed SUCCESS, with both cases actually
finishing1024 signed/business-qualified final transactions and zero business
rejection, failed execution, UNKNOWN, timeout or missing submission. Both child
closures cleaned completely; two empty scans separated the cases. One actual
VM/bootID/PIDnamespace/launcher and all four exact ELF files/source/compiler/
environment identities were verified. The post-fsync terminal verdict is
qualifiedtrue at16.136s; retained bytes42387618, within64MiB. Old failed39140104063
remains an independent failure, not retroactively passed.

| Actual finite1024 case | Relative | Bounded cadence |
|---|---:|---:|
| Workload window seconds |5.618121|4.796818|
| Effective business inclusion/final transactions per second |182.267339|213.474853|
| Actual offered interarrival rate |238.274224|311.365611|
| Inclusion P50/P95/P99 ms |1129.156/1839.594/2022.877|1193.552/1777.388/1857.117|
| Offer-to-final P50/P95/P99 ms |1293.478/1958.283/2131.142|1415.081/2054.578/2134.344|
| Supply-channel wait ms |0|527.544|
| Final-drain-channel wait ms |1322.920|1509.131|
| Pacing wait ms |3733.734|2377.707|
| Future-target wake lateness total ms |1777.678|1051.903|
| Successor signing ms |44.619|47.415|
| Encoding ms |108.220|96.697|
| Signed-journal append ms |388.353|218.836|
| Peak RSS bytes |586174464|587669504|
| Peak threads |63|64|
| Peak private data bytes |20726742|20972523|

Finite final rate increased17.1218%, offer rate30.6753%, while offer-to-final P95
**worsened4.9173%**. Candidate catch-up target decisions70, cadence resets39,
peak consecutive catch-up targets3 (four-offer bound preserved). The candidate's
new527.544ms supply wait includes submission/observation dependencies; do not
equate it with pure nonce or consensus waiting.

Commit subphases are preserved per node in
`evidence/pacing-pair-ci-39140997118-actual.json`. Relative nodes each committed7
times, means3.813–17.607ms; one node accumulated99.713ms fileSync while the other
three accumulated4.363–4.808ms. Candidate nodes each committed6times, means
3.729–4.388ms, cumulative fileSync2.571–4.693ms. Validation and delta/write timing
remain recorded separately. This real I/O variation, journal append difference,
fresh random fixtures and fixed relative→candidate order limit attribution:
these are single finite paired observations, **not an isolated universal pacer
speedup**, and not sustained1000TPS/ten-minute capacity. Higher offer rate also
increased finality P95, so both throughput and queue/latency must remain guards.

The offline readout binds the unique post-fsync terminal frame to pair receipt
SHA256, both child receipts and both complete raw transaction results, same
source/ELF/stable CPU identity and complete business qualifications. Only selected
ZIP members were recovered via exact206 with size/CRC and individual SHA256;
the entire archive was not downloaded or hash-verified. No second measurement or
load increase is authorized by this successful pair.
