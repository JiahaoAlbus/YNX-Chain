# Elastic endpoint submission candidate

Actual follow-up: [run39157615295](ENDPOINT_ELASTIC_ACTUAL_20261019.md) passed original business/resource/cleanup gates but final rate fell15.0874%, final P95 rose6.8841% and queue P95 worsened. Joint-and-tail acceptance failed. Keep the candidate default off; the following source controls are not a network improvement claim.

Status: source repair passed original CI `39156122998` at `329e5811fdd06ea05c8949560a424a82e3337072`; default off, no measured network benefit yet. The [source CI proof](evidence/endpoint-elastic-source-ci-39156122998-actual.json) binds the actual job/raw and shows fixture/network steps skipped. The [actual fixed-endpoint pair](ENDPOINT_FAIR_ACTUAL_20261019.md) retained its adverse queue tails and is not promoted.

Fixed one-worker-per-endpoint scheduling can strand otherwise available submitters while a slow request holds up different senders at that same endpoint. A controlled ordinary HTTP/JSON-RPC test now reproduces this with actual signed input and the original submission function: hold index0's request; index4 at the same authority cannot progress under the original fixed-worker policy. The RED run failed the intended progress assertion after completing real local execution, durability/readback and restart checks. Base commit plus the committed [RED patch](evidence/endpoint-elastic-red-41b21a994.patch.json) reproduce the failing source. The [local source evidence](evidence/endpoint-elastic-source-local-actual.json) pins raw outputs and patch SHA256.

The new explicit `-endpoint-elastic-submission` option requires `-endpoint-fair-submission`, paced ready-pool mode and exactly four submitters/observers. It reuses the original four submit goroutines and the original total queue capacity, divided by unchanged slot index%4 endpoint. Workers select pending eligible endpoints in round-robin order. A mutex/condition variable enforces at most four active callbacks total and at most two per endpoint. There is no additional worker pool or authority substitution. Original default shared queue and the old fixed per-endpoint1 option remain available unchanged.

Callback attempts, returns and peaks are actual scheduler counters; cancelled callbacks need not transmit RPC and are not counted as business success. Closure drains original queued callbacks before observers close. UNKNOWN quarantine, durable-before-dispatch, signature verification, fee/nonce checks and original business/finality gates are retained. More endpoint concurrency may move queues into RPC/server waits; the source tests do not establish a net performance gain.

Focused verification:

```sh
env GOMAXPROCS=1 go test -p 1 ./cmd/ynx-consensus-perf-client \
  -run '^(TestEndpointElastic|TestEndpointFair|TestSubmissionPhases)' \
  -count=1 -timeout=45s -v
env GOMAXPROCS=1 go test -p 1 ./cmd/ynx-consensus-perf-client \
  -run '^TestReadySenderFastAccountAdvancesBeforeSlowPeer/endpoint_elastic_reused_slots$' \
  -count=1 -timeout=30s -v
```

Twelve focused tests passed, plus the reused-slots test with six real signed local executions, fee/nonce readback, terminal evidence and restart. The four ordinary HTTP endpoint cases retain original authority/request-once checks, exercise progress with one delayed request and with a wholly delayed endpoint, wrong-hash UNKNOWN (30 final/1 UNKNOWN/1 unsubmitted), cancellation with late replies (24 final/2 UNKNOWN/6 unsubmitted), and no business promotion after cancellation. Separate close/drain coverage checks all16 callbacks exactly once and the original total queue/global worker caps. Unit quorum/Merkle gate flags are explicit fixture inputs, not a BFT network claim. The original CI already runs this package; no replacement test framework was added.

The original controller/workflow now has an explicit `shared-elastic` pair (`linux_supply_pacing=paired-shared-elastic`), requiring gRPC, fixed512x2 and observer phase timing. Preparation is read-only:

```sh
python3 -B scripts/loadtest/supply-linux-window.py --prepare-pair \
  --pair-kind shared-elastic --observer-phases --transport grpc --profile supply-512x2
```

Both sides use one source/VM/four compiled binaries with identical observer/submission phase measurement and shared replay enabled. Original shared submission baseline is compared against elastic endpoint policy. All1024 original signed business rows, callback peaks, queue/CheckTx P95/P99 and offer-to-inclusion/final P50/P95/P99 must pass original qualification and joint-tail checks. Original HTTP hook offsets are independently checked against callback duration and summarized by nearest rank on both sides. Missing/repeated hooks are refused; overlapping write/first-byte hooks retain explicit overlap counts and sample denominators rather than inventing negative intervals. Client/case/pair phase facts are hash-bound and compared, not accepted from a standalone summary.

Fifty controller tests pass, including synthetic orchestration failure/UNKNOWN/authority/phase/counter/cap/closure/fsync cases and explicit CLI refusal. They launch no nodes and do not replace real measurements. Four original pair recipes retain exact SHA256 pins. Pair120s, case45s active+15s cleanup, invocation including fsync<=60s,1GiB sampled RSS,32MiB private data and64MiB combined retained caps remain unchanged. A new isolated window requires Root's fresh slot grant and actual admission; no retry or promotion follows source PASS. Sustained1000TPS for ten minutes remains unqualified.
