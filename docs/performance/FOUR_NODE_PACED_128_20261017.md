# Four validators: new 128-transaction paced window

Root authorized one new isolated local window using the reviewed preparation
receipt SHA-256
`b304aa9411bc03c82825bf965cd5f57b747854a8d0ee055b77a8c3e17082b3d0`.
The runtime is the separately built `2f446351f` ABCI candidate (SHA-256
`074487eb00468ba6b2a6cecbb6f99d782a608fba06d66a64f9b9be102893f292`), with the
original frozen paced client, fixture, native host probe and CometBFT v0.38.23.
The five binaries and strict launcher all matched the reviewed digests at entry.
The earlier 32-transaction run and failed admission/recovery attempts are retained
separately; no old resource-window permission was reused.

## Configuration and lifecycle

Apple M4, 24 GiB RAM, macOS arm64, Go 1.25.7; each child `GOMAXPROCS=1`, nice 10.
Four CometBFT nodes and four ABCI processes, four submit workers, four observer
workers, 128 independently signed native transfers, offered at 64/s, client
deadline 10 seconds. Limits: 45 seconds active plus 15 seconds cleanup,
1 GiB owned/control RSS including sampler reserve, 32 MiB data growth,
9 simultaneous long-lived children, 320 threads with control reserve and
1 MiB log per process.

Entry observed 85,843,189,760 bytes free, satisfying the fresh floor plus the
425 MiB Root reserve and maximum data delta. All 12 ports were free. A persistent
owned shell started the launcher and waited, avoiding the previous accidental
shared-service parent scope. The shared tool service still existed: its separate
entry baseline was 1,649,296 KiB RSS; system-wide memory free was 45%. This does
not establish a whole-host peak or explain historical os35 failures.

Window `window-gDe1lM` started at `2026-10-17T08:58:00.981Z`, completed normally
in 7,020 ms and cleaned up in 103 ms. No guard failure, forced kill, retry or
second window occurred. Observed owned/control peak RSS was 454,311,936 bytes
(433.3 MiB), data 4,087,808 bytes (3.90 MiB), threads 72 and live children 9.

Shell 11680, launcher 11685, fixture 11713, ABCI 11766/11790/11814/11838,
CometBFT 11863/11887/11911/11935 and client 11970 were terminal. All child exit
codes were zero, every process group was gone, fresh PID checks found none
present, and ports 31656–31659, 31757–31760 and 31858–31861 were rebindable.
The slot was explicitly returned to Root before offline checks.

## Actual transaction observations

| Stage or outcome | Count |
| --- | ---: |
| offered / submitted / verified code-zero CheckTx ACK | 128 each |
| code-zero included / weighted quorum verified / local durable final | 128 each |
| rejected / execution failed / submission unknown | 0 each |
| timed out / observation failed / not submitted | 0 each |

There were **115 retained observation errors**, all RPC `-32603 tx(<hash>) not
found` while waiting for inclusion. They are not hidden or reclassified as
successful responses. Every transaction ultimately completed; these observations
did not represent transaction rejection or unknown submission retries.

The complete workload window was 3.172157791 seconds, including submission and
observation/drain, excluding node setup. Measured offered and submission
interarrival rates were 63.9674/s and 63.9673/s. Submitted, accepted, included,
quorum-confirmed and durable-final full-window rates were each **40.3511/s**.
They are separate gates with equal counts in this run, not interchangeable
definitions of TPS.

Blocks 4/5/6 contained 56/52/20 workload transactions. All block transactions were
observed, code zero and proof verified. The conservative active-offer interior
calculation has only one complete interval: 52 transactions / 0.896004 seconds
= **58.0355 effective transactions/s**. The edge blocks are excluded from that
finite interval estimate. `steadyStateEffectiveTPS` remains null.

| Client-observed latency, ms | P50 | P95 | P99 |
| --- | ---: | ---: | ---: |
| submission queue | 0.002916 | 0.012375 | 0.016667 |
| CheckTx response | 4.193 | 41.661 | 60.730 |
| code-zero inclusion observation | 1,114.455 | 1,387.665 | 1,430.015 |
| weighted quorum plus local durable observation | 1,116.693 | 1,394.779 | 1,434.714 |

These clocks start at each actual submission and include polling, RPC and
observer scheduling. Peak offered-awaiting-submit was 1; accepted-awaiting-
observation-completion was 83. These are genuine observations of included and
durably executed transactions, not internal node decision timestamps. Signed
block times are retained separately and are not substituted for latency clocks.

## Independent convergence and stopped replay

All four durable snapshots ended at height 6 with 128 fee records, each
166,288 bytes. Each snapshot SHA-256 is
`d6f563e5150e3bd2663d249c4c866ac5c12fed845e24ae6f435377e644b81d70`, and each
AppHash is `6a0afb436a2608b238c9aea9e4acd7db265a89f0394b4eefea9e4361431077b0`.

After stopping, the bounded replay test opened every blockstore read-only,
verified signed commits against the local genesis validator weights, checked
signed prior-state AppHash transitions, re-executed the actual block payloads
and compared complete state to that node's durable snapshot. It passed in
0.13 seconds for all four nodes, 128 transfers per node. This remains 128 network
business transactions, not 512. It is offline re-execution, not a live node
restart or multi-node crash-recovery drill.

The transaction-height header authenticates the preceding application state.
Same-height local disk readback is separate evidence. RPC execution code alone
is not a cryptographic execution proof; independent stopped re-execution and
all-node convergence provide additional execution evidence without inventing a
same-height signed current-state root.

The original observations, lifecycle receipt, public signed blocks, convergence,
fresh admission, PID/port checks and preparation identities are retained in
[the evidence JSON](evidence/four-node-paced-128-20261017.json). Private validator
key files remain only in the ignored isolated runtime directory.

## Qualification boundary

This is one successful short low-load network run. It is not comparable as a
same-condition optimization A/B with the earlier 32-transaction closed-loop run.
P95 is below 3 seconds under this stated load; neither sustained 1,000 business
commits/s for ten minutes nor the 3,000–5,000/10,000 targets are established.
Next load growth or duration requires a new Root schedule. Source work on
history/persistence and client observation overhead continues independently.
