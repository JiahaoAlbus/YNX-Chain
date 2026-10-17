# Four validators: 1,024 ready-pool business transactions

All **1,024/1,024** signed native transactions reached identity-bound CheckTx
acceptance, authenticated code-zero inclusion, actual fee/nonce readback and
final quorum + local durability + published Info observation. The complete
8.823351833 s workload delivered **116.055669 effective final business tx/s**.
Actual offered interarrival rate was **138.726591/s**, below the configured
maximum pace 512/s. This is a bounded regression, not sustained 1,000 TPS.

256 fresh senders each completed nonces 1 through 4. All four stopped nodes
replayed the actual 1,024 payloads with authenticated block signatures and
byte-identical complete state. Independent account readback verified each
sender's nonce 4, exact migration balance minus eight and all 1,024 fee events.

## Observed timing and workload

| Latency from submission start, ms | P50 | P95 | P99 |
| --- | ---: | ---: | ---: |
| CheckTx response | 9.195 | 56.499 | 86.780 |
| Verified effective business inclusion | 1,180.292 | 1,666.572 | 1,864.715 |
| Final quorum + durable + published Info | 1,440.342 | 1,846.729 | 2,013.124 |

Submission queue delay was 105.226 / 543.857 / 609.256 ms. Including that
queue, offer-to-final latency was **1,517.901 / 2,342.776 / 2,617.751 ms**.
Those percentiles sum each transaction's two saved monotonic spans first,
then take nearest-rank percentiles; they do not sum independent percentiles or
subtract wall clocks. All timings include observer/poll/RPC overhead and do
not claim internal node timestamps.

All offered/submitted/accepted/effective-included/final counts are 1,024, so
their common complete-window rate is 116.055669/s. Submission interarrival rate
is separately 137.634232/s. Reject, execution failure, UNKNOWN, timeout,
observation-failed, unsubmitted and quarantined-account counts are zero.
There were 9,098 interim block-scan waits and 531 local-durability-not-ready
observations, retained separately from terminal business failures. Some scan
waits were BlockResults not yet available; no uncertain write was retried.

The real ready schedule removed whole-round barriers: nonce cycle 2 first
offered at 13:36:02.974 UTC before cycle 1's last final observation at
13:36:03.045; cycles 3 and 4 overlap their preceding cycles too. Per-account
successor offers occur only after that account's previous final observation.
All 1,024 signed hashes are unique, with 256 exact nonce sequences 1/2/3/4.

Blocks 4 through 12 contain **256 / 42 / 139 / 144 / 123 / 104 / 152 / 35 / 29**
observed valid business transactions, with complete proof coverage. Finite ready
pool input, idle readiness periods and drain prevent a sustained/interior TPS
qualification; those fields remain null.

## Actual confirmation work and limiting evidence

The run issued **zero individual Tx queries**. It performed 218 Block queries,
43 Commit/Validators/quorum/BlockResults calls, authenticated 38 node-block
captures and used 35 cached header confirmations. Five BlockResults read-only
retries did not advance the corresponding scanner cursor. Largest durable
batch was 64; 35 readback attempts yielded 24 full reconstructions. All 1,024
observed transaction signatures were checked, with 10,407,827 fresh file bytes
hashed. Reconstruction separately replayed 157 tail blocks / **15,352 historical
inputs**; these are not additional business transactions.

Peak offered-awaiting-submission queue was 141, accepted-awaiting-observation
256 and in-flight accounts 256. Combined with P95 submission queuing 544 ms,
these show the client did not keep its configured maximum pace. Subsequent
short profiling found repeated native crypto verification in journal replay
and motivates a separate bounded exact-payload facts cache. That later source
was not present in this run; neither its microbenchmark nor this different-size
window establishes a before/after network gain.

## Frozen identity, resources and cleanup

Root authorized exactly one fresh window for preparation 10,901 bytes / SHA-256
`62231d52f5b364f2c4ec9c64b886585f041c4d0ac6766e12fbaca6b93d260a99`.
Client source `fff2ff67ec72df1e4935bc2ebda74ad02ec2a03e`, binary SHA
`72a3904601321263cb8f7a1b932944e4bffda40f74e81fdd759bfba26b8f09b8`;
runner SHA `1641062230fd8534da1ed4159837c28da73e6c60ea15649813c1f8125f4390b0`.
Core/app remain e3b7b4b72 / ed2e8403 with original fixture/host/Comet pins.
Later decoder-cache source changes did not replace any frozen executable.

Apple M4 / 10 logical CPUs / 24 GiB, Go 1.25.7 darwin/arm64, GOMAXPROCS=1,
nice 10. Admission 13:35:49.931 UTC matched all hashes, found 57,477,853,184
workspace bytes free, owned network processes zero and all twelve ports
rebindable. VM free pages were 46,167 × 16 KiB; this is not total available RAM.
Actual owned shell START 13:35:57 UTC, session 98091, shell 17525 / runner
17526. `window-RWY2KW` began 13:35:57.761 UTC and ended in 12,718 ms, cleanup
102 ms, exit zero, first cause null.

All caps stayed 45+15 s, 1 GiB owned/control RSS, 32 MiB aggregate data,
nine long-lived children, 320 threads with reserve, four submit/four observe,
10 s client, original logs/ports/disk floor + reserve. Sampled peaks were
566,902,784 RSS bytes, 22,806,528 data bytes, 74 threads and nine children.
Peak per-scanner retained evidence charge was 944,316 bytes, not actual heap.

All original shell/runner/fixture/four ABCI/four Comet/client PIDs and process
groups were absent at independent checks 13:36:20.855 and .856 UTC; every
original port was rebound/closed in both passes. Root received formal heavy
slot return before offline work. No second or larger run used this permission.

Stopped replay passed 2.05 s (package 2.590 s); independent account readback
passed 0.64 s (package 1.076 s). All four nodes ended height 12 with AppHash
`5e45d8e853a803dc89d5428a656ad4d13c01c6a5eec8ea559100e18c104b9cdc`,
canonical snapshot SHA
`319cb25ca95001a6545372237bdd6f9b077a742be0ea2c5dbc5e8d6991c83344`,
and store SHA
`48eb16ce9d3ba4b9cb3a712f500cc3293abe9f36b947c9216bd6a55d2747dea7`.
This is 1,024 business transactions, not 4,096 from four offline replays.
No live node crash/restart drill is claimed.

[Raw preparation, admission, observations, signed blocks, account readback and cleanup](evidence/four-node-ready-block-scan-1024-20261017.json)
include derived per-account ordering and queue-inclusive latency checks.
Next validate the replay-cache optimization independently, then schedule an
identical-shape network comparison. The at-least-ten-minute 1,000 effective
TPS goal and larger 3,000–5,000 / 10,000 TPS stages remain incomplete.
