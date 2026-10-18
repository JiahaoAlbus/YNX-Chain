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
