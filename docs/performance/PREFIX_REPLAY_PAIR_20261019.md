# Same-VM shared versus prefix replay pair

The original Supply controller and chain-core workflow now register the explicit
`shared-prefix-data64` pair. This completes the missing execution route identified
in PREFIX_REPLAY_CLIENT_20261019.md. It is source implemented and locally verified;
no new network comparison, admission or performance improvement is claimed here.

One job builds the same four ELF binaries once. The original pair wrapper runs
shared replay then prefix replay serially on the same actual native Linux amd64
VM, source, compiler, runtime environment and workload policy: each side2048 fresh
signed nonce1 transactions, configured1000 offers/s, four submitters and four
observers, grpc/relative/block-scan with original phase timing. Random fixture
identities, startup order and block scheduling differ; this is a finite comparison.
The existing boolean prefix_durable_replay stays false for the pair because the
registered pair selects the exclusive backend for each side itself.

The explicit contract is evidence/prefix-pair-data64-pregrant-contract-20261019.json:
7042 bytes, SHA256 bbbcf1a15338e86d54ee4283234e4f8feb2ebfd887281aa42a525f555c90dab0.
It binds controller commit8f4532b3e0dc0b74e5c7af900ab513a05ea43152 and all three
controller/workflow/test file hashes. Exact dispatch HEAD must additionally pass
normal CI. This preparation is not execution authorization or fresh admission.

Each case keeps64MiB private data including its own receipt,1GiB sampled owned
RSS,10 owned processes/9 children,320 threads,1MiB stdout/stderr and45s active+15s
cleanup with total including fsync<=60s. Explicit aggregate retention is128MiB,
logs2MiB, build1GiB and total120s including both guards, closures and aggregate
receipt fsync. Original default pair64MiB and all native default caps are unchanged.
Fresh native MemAvailable/disk floors still apply; initial pair admission also
reserves128MiB beyond original disk/root/compile reserves. Per-case accounting
charges only its own receipt, while aggregate accounting charges every retained
case, receipt and evidence byte. It cannot delete old evidence to fit.

Every case must qualify all2048 original fixture bytes/hash/nonce/business rows,
independent inclusion/quorum/published-state/durable proof flags, actual backend
work counters and original observer/submission timings. Result hashes and case
measurements are reread before the next case. UNKNOWN, incomplete cleanup, failed
case, changed binary/host/source/environment, mismatched receipt or raw proof,
capacity refusal and final fsync/deadline failure cannot pass. Two empty owned
closure scans precede the second case; failure never falls back or retries it.

The pair receipt preserves all case summaries, raw reader work, node Commit
children, submission boundaries, queue-inclusive offer-to-inclusion/final P50/P95/
P99 and original queue peaks. Its existing joint verdict requires increased finite
final rate, no worse inclusion/final P95 and final P95<=3s; adverse results remain
visible. Even a positive finite pair does not qualify ten-minute sustained1000
valid business TPS or change defaults.

Local controller65 tests passed3.717s. Three new tests exercise serial selection,
original fixture/raw/phase/receipt refusals, binary change, UNKNOWN, post-fsync
refusal, scoped64/128MiB limits, initial aggregate reserve and exact once receipt
accounting. Running the new route tests against the original a8b878 controller
produced the retained missing-route RED. The source gate additionally binds the
three controller files to their exact commit and rejects each mutated file; all8
top-level source tests passed9.641s including original frozen diagnostic/anchor
suites. Existing controller recipe/hash contracts remain tested unchanged.
Raw file sizes and SHA256 pins are in evidence/prefix-pair-source-local-actual.json.
No nodes, fixture generator, build workload or workflow dispatch was started by
these local controller tests. The isolated normal read EAGAIN and bounded normal
recovery are retained separately; no hook or platform limits were bypassed.
