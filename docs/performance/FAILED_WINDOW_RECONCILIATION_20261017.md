# Failed replay-facts network window: offline reconciliation

The cache candidate's four-node window `window-1ZsLDk` failed on a native
resource probe `spawnSync ... ETIMEDOUT`, not a completed performance result.
The original 1,500 ms timeout and all workload/resource caps were retained.
No network rerun or transaction resubmission was performed for reconciliation.

The live partial report remains 730 submitted / 727 verified CheckTx accepted /
667 observed code-zero quorum inclusions / 654 qualified final observations,
with 73 observation timeouts and three submission UNKNOWNs. Its elapsed
8.548-second partial workload and latency samples cannot establish sustained
TPS, or a successful before/after network comparison. The source reconstruction
benchmark's 71.67% warm-cache reduction is not a network throughput result.

## Read-only recovery result

A separate explicit-env test verifies the failed-window identity and its retired
process receipt, validates the fixture/genesis/migration bindings, and decodes
all 856 complete signed ready-journal intents. It opens each Comet blockstore
with `ReadOnly: true`, authenticates every block through the node's actual durable
height against the trusted genesis validator set, verifies data/block hashes,
and replays every payload in an in-memory application. Each signed prior AppHash
must match; each result must succeed. Full replayed state must be byte-equal to
the stored state, including exact fee identity/payer/type/height/amount and nonce.
Every original node data file plus ABCI store is hashed before and after; the
aggregate must remain equal. Nothing above the actual durable height is counted.

All four nodes have blockstore height **11**, durable height **11**, **712**
actual successful payloads, no incomplete journal tail and identical complete
state. The original Comet process requiring SIGKILL during bounded cleanup is
still recorded as such; offline verification does not rewrite its exit status.

| Original live status | Durable on all four nodes | Absent on all four nodes |
| --- | ---: | ---: |
| Confirmed | 654 | 0 |
| Observation timeout | 58 | 15 |
| Submission UNKNOWN | 0 | 3 |

The remaining signed intents were never submitted or not present in the live
report, and none appears in any durable state. The same 712 transactions exist
on every node; summing four replicas would be incorrect. Offline recovery adds
no ACK, observation timestamp or latency sample, and does not revise original
online counts. All three UNKNOWN inputs remain retired; absence from these
stopped local stores is not permission to resend.

Canonical snapshot SHA-256:
`152cfb1f9815ce766d66b5c0cb91688b29e3da6fd614edbcca896ee5a1593d25`.
Original store SHA-256:
`19e12b0f88a6dcb6803554c602c45ccf54bcb14bc970d6af8ad68b4fd1e732a2`.

## Execution and reproducibility

The initial `go test` failed before test execution with compiler startup
`resource temporarily unavailable`. One subsequent GOMAXPROCS=1 / nice 10 /
Go -p 1 compile succeeded, and the retained binary executed once: **PASS 1.20 s**.
This was offline reading and in-memory replay, with no listeners or node starts.
At 15:12:23.777 UTC all original PIDs/groups were again absent and all 12 local
ports passed bind/close checks. These facts do not prove the host scheduling
cause of the original timeout.

```
GOMAXPROCS=1 nice -n 10 go test -p 1 -c \
  -o artifacts/chain-performance-20261017/partial-reconciliation-client.test \
  ./cmd/ynx-consensus-perf-client
GOMAXPROCS=1 YNX_CHAIN_PARTIAL_STOPPED_WINDOW="$PWD/artifacts/chain-network-performance/window-1ZsLDk" \
  nice -n 10 artifacts/chain-performance-20261017/partial-reconciliation-client.test \
  -test.run '^TestStoppedPartialNetworkReconciliation$' -test.count=1 -test.v -test.timeout=45s
```

The output uses exclusive creation: do not rerun against the same output path
or delete the evidence to make the command pass. The completed-window replay
and account tests retain their original strict success requirements.
[Original failure receipt, original summary, all 856 per-hash reconciliation
records, input/source/binary hashes](evidence/failed-window-reconciliation-20261017.json)
are retained. Full original reports and databases remain in the isolated window.

Next: maintain the async probe's failure behavior, prepare a bounded streaming
client capable of the ten-minute workload, and schedule a fresh exact network
candidate with Root. No new heavy grant is implied by this offline pass.
