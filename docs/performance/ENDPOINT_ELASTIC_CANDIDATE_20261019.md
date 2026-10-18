# Elastic endpoint submission candidate

Status: source repair and focused local validation; default off, no measured network benefit yet. The [actual fixed-endpoint pair](ENDPOINT_FAIR_ACTUAL_20261019.md) retained its adverse queue tails and is not promoted.

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

Next network comparison must use one source/VM/four compiled binaries with identical observer/submission phase measurement in both cases, shared replay enabled in both, original shared baseline versus elastic endpoint policy. Read back all original rows, submission queue/CheckTx P95/P99 and offer-to-inclusion/final P50/P95/P99, plus business counters, actual peaks, cleanup and post-fsync closure. Keep the existing runtime/data/process caps. A new isolated window requires Root's fresh slot grant; no retry or promotion is implied by local PASS. Sustained1000TPS for ten minutes remains unqualified.
