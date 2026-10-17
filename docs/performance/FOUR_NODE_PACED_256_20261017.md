# Four validators: 256 transfers at 128 offered/s

Root separately authorized this one new window after the preceding 128 run had
fully returned its slot. Reviewed preparation receipt: 9,198 bytes, SHA-256
`f633db4f21263a8b7afb77df2094a04320e52f26852a7b25dd755241d5922411`.
Core runtime remains `2f446351f` (app `074487eb...`); the new client is
`deaad807c` (SHA-256 `5a5598a4b707866e5061d8fb806502fcd8c6cf30cee21c07fff3e260144d1d51`).
Fixture, native sampler, strict launcher and CometBFT v0.38.23 remain the frozen
inputs. All hashes matched at actual admission. Preparation did not imply prior
permission to execute; the new explicit Root grant authorized only 256 at 128/s.

## Resource and lifecycle evidence

Apple M4, 24 GiB RAM, macOS arm64, Go 1.25.7, `GOMAXPROCS=1`, nice 10.
Four ABCI plus four CometBFT processes, four submit/four observer workers,
client timeout 10 seconds. Original strict caps: 45 seconds active plus
15 seconds cleanup, owned/control RSS 1 GiB with sampler reserve, data 32 MiB,
9 live long-lived children, 320 threads with reserve, 1 MiB log per process.

Fresh entry found 82,017,308,672 bytes free, all previous owned PIDs absent and
all 12 ports free. The 425 MiB Root reserve plus disk floor/delta was preserved.
Shared tool service baseline remained separately visible at 1,361,168 KiB RSS;
system memory free was 51%. It was not killed or excluded from a purported
whole-host total. The guard's RSS scope is owned/control processes, not all
applications on the machine.

The owned parent shell actually started the runner and waited. Window
`window-8VnYLw` began `2026-10-17T09:16:13.903Z`, completed in 7,670 ms and
cleaned up normally in 103 ms, with no first cause, forced kill or retry.
Peak owned/control RSS was 486,588,416 bytes (464.05 MiB), data 6,873,088 bytes
(6.55 MiB), threads 71 and live children 9.

Shell 50711, runner 50716, fixture 50744, ABCI 50770/50794/50818/50842,
CometBFT 50867/50891/50915/50939 and client 50982 were terminal; all child exit
codes were zero and all groups gone. Fresh PID checks found none present, and
all ports 31656–31659, 31757–31760, 31858–31861 were rebindable. The actual
START/session/PID and terminal/slot-return were reported to Root. Subsequent
inspection was offline and did not retain the heavy slot.

## Workload and observed results

All **256** transfers were offered, submitted, ACK-identity verified, accepted,
included with code zero, weighted-quorum verified and matched to local durable
fee/nonce evidence. Rejects, execution failures, unknown submissions, timeouts,
observation failures and unsubmitted inputs were zero.

All **128 retained observation errors** were RPC `-32603 tx(<hash>) not found`
while awaiting inclusion. They remain in the raw results; none represented a
business rejection or triggered a write retry.

Measured offer/submit interarrival rates were 127.9984/s and 127.9983/s. The full
workload window, including observation/drain, was 3.439787459 seconds. Full-window
submission/acceptance/code-zero inclusion/quorum/durable-final rates each equal
**74.4232/s**, with their definitions retained separately.

All observed block coverage was complete: heights 4/5/6 contained 112/126/18
valid workload transactions. The conservative active-offer interior estimate
has only one interval: 126 / 0.900556 seconds = **139.9136 effective tx/s**.
This finite interval can differ from the offer rate because of block timing and
pending work; it is not steady-state capacity. `steadyStateEffectiveTPS` is null.

| Client-observed latency, ms | P50 | P95 | P99 |
| --- | ---: | ---: | ---: |
| submission queue | 0.002 | 12.492 | 39.240 |
| CheckTx response | 3.986 | 40.531 | 71.872 |
| code-zero inclusion observation | 1,211.836 | 1,577.835 | 1,632.712 |
| quorum plus local durable observation | 1,212.922 | 1,580.762 | 1,644.599 |

These are monotonic submission-to-observation durations including RPC, polling
and observer scheduling, not internal node decision clocks. Peak offered-awaiting-
submit was 7; accepted-awaiting-observation-completion was 193.

## New durable reader in actual use

The actual schema-4 client reports 256 attempts, **68,398,044 bytes freshly
streamed/hashed**, 12 whole-snapshot validations, 244 exact-digest snapshot hits
and 256 transaction signature verifications. It did not substitute file metadata
for current bytes or cached admission for fee/nonce verification. Quorum and
Merkle proof checks remain independent of local readback.

This is the first network observation with this reader. The preceding run changed
both client version and load, so it is not a same-condition client-optimization
A/B. The reader's separate operation-level comparison remains in
[its report](DURABLE_READER_20261017.md).

## Independent convergence and stopped replay

Every node ended at height 6 with 256 fee records and a 328,830-byte snapshot.
All snapshot SHA-256 values are
`2c43e4fb852c1d8f285edf40b5cc98e5954a867725e778d358ad24d66c299b1c`;
all AppHashes are
`53267f8ba36e96d4626ae219a0c82cfa46701f58d9670fbc4cfc1926d34bdebf`.

After shutdown, read-only blockstore inspection independently verified signed
commits and prior-state AppHash transitions, then re-executed the actual payloads
and compared complete state to every durable snapshot. The stopped replay passed
in 0.22 seconds for all four nodes, 256 per node. This remains 256 network
business transactions, not 1,024. No live restart occurred. The same-height
header still commits the preceding application state; local readback and stopped
execution are additional evidence, not an invented same-height signed state root.

All original receipts, transaction observations, public signed blocks, fixed
preparation identities, resource samples, fresh admission and PID/port checks are
in [the evidence JSON](evidence/four-node-paced-256-20261017.json). Private runtime
keys remain only in the ignored isolated data directory.

P95 is below three seconds at this particular short load. Ten continuous minutes
at 1,000 valid business commits/s, sustained backlog/error/resource behavior and
the higher-stage targets remain unproven. The current count/time/history limits
also need further source work. No second or larger run is authorized by this
completed slot; future execution requires a fresh Root schedule.
