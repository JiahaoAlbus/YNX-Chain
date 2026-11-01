# Controlled local resource executor

`NewDisabled` is the production default. The helper exposes no production start/worker-verification API; its kernel-authenticated native channel only supplies disabled-state status, metering and stop, and this package contains no production publisher root. `NewControlledSandbox` requires a trusted fixture authorizer and labels every receipt `CONTROLLED_SANDBOX`; temporary test Ed25519 signatures do not imply original-issuer authority or production PQ support.

`verify_chunk` and the fixed no-import WASM public-block histogram are implemented as controlled local work kinds. A canonical manifest binds the exact job, issuer, input byte length and SHA3-512/SHA-512, expiry, and resource limits. A separately verified consent binds its principal, job, that complete manifest, identical limits, expiry and single-use nonce. Other work kinds, disk allocation and egress are rejected. Jobs never contain executable code, URLs, host paths or shell commands.

There is one operation at a time, with at most 8 MiB input, 24 MiB reserved work memory and five seconds wall time. Hashing checks cancellation between 4 KiB chunks. `cpuMilli` controls a cooperative duty cycle with a bounded chunk burst; it is not an OS-enforced CPU quota. Memory limits describe work buffers, not the entire Go host process. The additional fixed-worker Darwin process controls and their limits are described below; production containment remains incomplete.

`StopContribution` seals new scheduling, cancels the owned operation and waits for its accounting and quota release. Restart schedules nothing and `NewDisabled` remains disabled. The atomic productstore journal preserves local measured usage, consumed approval nonces, one result/receipt per job and independently reverified bytes. Its checksum is integrity protection, not issuer authentication. Its private known `.owner.lock` marker uses a real kernel lock, so a crash releases the live writer without deleting the journal. Unknown legacy `.owner` directories and unknown marker files are preserved for explicit reconciliation, never automatically removed. Interrupted jobs never replay automatically, and their recorded usage is a lower bound.

`VerifyWorkReceipt` re-reads the original bytes before counting a job. On restart, old verified receipts remain historical and count zero; original manifest and user-consent signatures must pass again before re-auditing, and the old job is never executed again. `VerifyResourceMeter` derives unique verified jobs from current-process checks; it accepts no self-reported CPU or imported counters, and reports rewards `NOT_AUTHORIZED`. This is local sandbox evidence, not global service, settlement, governance weight or public resource-network proof. A journal write failure is surfaced by `Wait`, `StopContribution` and `Close`, keeps scheduling sealed and retains the owner lock for reconciliation.

The existing Resource Market `PrepareMeter`, `RecordUsage` and `ConfirmSettlement` remain their original owners' provider-metering/economic authority. They are not reused as volunteer-job authorization. Production integration needs the canonical issuer/key-epoch/revocation manifest verifier and genuine local user-consent contract, plus an OS quota and lifecycle adapter. No existing resource daemon, schema, shared lock or economic state is modified.

Canonical test discovery: `GOMAXPROCS=2 go test -p 1 ./cmd/ynx-network-helper -run 'TestP09(07|08|09)Contribution'` (also discovered by existing `make test`).

The fixed `public_block_histogram_wasm_v1` adapter also supports a controlled
Darwin process mode. Both the no-import WASM interpreter and a fixed native
read-only sampler must have independent build pins. A fresh private FD3
challenge binds worker limit readback; input is released only after that
readback and sampler readiness. The sampler verifies the live child's UID,
parent and start identity, converts Mach CPU ticks through `mach_timebase_info`,
and reports a CPU-budget threshold. Only the original Go parent kills its owned
`os.Process`; cancellation/stop waits for both worker and sampler. No persisted
PID can be used to signal a later process.

The worker applies/readbacks CORE=0, FSIZE=0, NOFILE=32, NPROC=0 and whole-second
CPU limits before stdin. The actual busy-loop probe demonstrated that a CPU=1
readback alone did not stop that Go process by seven seconds; that failure is
retained. The parent therefore uses a 10ms sampled aggregate CPU budget plus an
independent wall deadline and hard kill. Sampling can overshoot under scheduling
pressure and does not enforce a hard CPU share. File growth restriction is not a
total disk/metadata quota. Work/WASM memory bounds are not a hard host RSS limit.
`productionReady` remains false, as does the normal production contribution API.

Per-child wait4 user/system CPU and maximum RSS are local observations. Worker
and sampler CPU are counted once each, including historical journal records;
peak RSS is the maximum of individual processes, not simultaneous aggregate
memory. Independently rechecking bytes does not charge child CPU a second time.
These observations confer no CPU service proof, rewards, issuer authority or
human consent. The original SDK has confirmed that canonical resource issuer
key-epoch/current revocation and resource-specific native consent are still
missing owning CODE; node/TX/AI approvals cannot substitute for them.

Darwin delta CI: `go test -p 1 ./cmd/ynx-network-helper -run
'TestP09(OSLimitedFixedWorkerLifecycle|OSMonitorStopsUncooperativeChild|DarwinWorkerOSLimitModule)$'`.
