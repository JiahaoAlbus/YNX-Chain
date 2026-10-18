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
