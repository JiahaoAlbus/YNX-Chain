# Discover inclusion by authenticated block

The actual grouped four-validator window issued 600 Tx queries for 64 business
transactions, including 536 not-found polls. Grouping durable reads did not
remove this per-transaction discovery cost. `-inclusion-mode block-scan` now
provides a separate path alongside the retained `tx-query` comparator. It is
wired through both paced rounds and the per-account ready sender pool, and
requires four node-affine observers.

Each node scanner starts at migration height plus one, reads the latest block
to discover its tip, then scans consecutive heights. Exact block identity,
genesis-bound validator weights, signed header and weighted commit signatures
must pass before its cursor advances. Block payload hashes must match the
authenticated DataHash. A single Merkle-tree construction yields individual
proofs for all members. BlockResults height/count and result presence are
checked; its code alone is not trusted as proof of business execution.

The scanner owns cached signed headers, payloads, execution-code values and
proof bytes. Late ACKs can match an already scanned block, but obtain their own
current inclusion/finality observation timestamps. No timestamp is backdated
to the cached scan or signed block time. Each final group still freshly hashes
the current local state file, verifies every signed native transaction against
its exact fee/hash/payer/type/height and nonce, and checks published ABCI Info.
An authenticated header cache never substitutes for that fresh readback.

Read-only RPC failures retain the same cursor for polling. Complete invalid
block/signature/results evidence poisons that scanner and fails affected
observations without a transaction-query fallback or any submission retry.
Evicted evidence does not invent inclusion; absent inputs remain unobserved.
Context expiration cannot publish a new cache entry or successful final result.

## Finite bounds and metric meaning

Each poll scans at most eight heights; this finite window permits 128 heights.
Each scanner retains at most 16 blocks and an 8 MiB evidence charge, comprising
signed-header bytes, raw transactions, logs and per-entry/proof charges. This is
cache accounting, not an exact Go heap/RSS measurement. The scheduled runner's
separate 1 GiB owned/control RSS guard remains unchanged. Four node-affine
workers avoid duplicating each node's scanner. A block accepts at most 2,048
transactions / 8 MiB raw inputs, each result log at most 4,096 bytes. Individual
HTTP RPC response bodies now stop at 16 MiB and close the original body; the
same loopback allowlist, timeouts and connection counts remain.

Schema 10 adds block/result query counts, authenticated scanned blocks, cached
confirmation hits, peak cache charge and explicit inclusion mode. Legacy
`includedCodeZero`/quorum fields remain stage observations. New
`effectiveBusinessIncluded`, its full-window rate and inclusion latency, plus
`validInclusionBlocks`, require actual fee/nonce/durable publication evidence.
A signed transaction proof and unsigned RPC code zero cannot inflate these
business metrics. Final throughput retains the independent final-observation
gate. Inclusion/finality timings are client-observed upper bounds including
poll/RPC work; no internal node timestamp measurement is claimed.

## Same-input comparison

Apple M4 / 10 logical CPUs / 24 GiB, Go 1.25.7 darwin/arm64, GOMAXPROCS=1,
nice 10. Both cases use the same retained real 32-transaction signed block at
height 4 in `window-oJZYQJ`, the same exact migration/genesis trust anchor and
the same real 50,154-byte V2 durable store. The exact same test binary runs
three samples per case in order **query / scan / scan / query / query / scan**,
150 ms each. Each operation authenticates all 32 original signed inputs and
hashes the current full store. The parsed-state cache is warmed beforehand.

| Median per complete 32-transaction verification | Grouped Tx query | Block scan |
| --- | ---: | ---: |
| RPC API method calls | 35 | 5 |
| Individual Tx queries | 32 | 0 |
| Native signatures checked | 32 | 32 |
| Fresh store bytes hashed | 50,154 | 50,154 |
| Local time, ms | 3.197160 | 3.244522 |
| Allocated bytes | 243,729 | 308,223 |
| Allocations | 2,336 | 3,069 |

RPC-method work falls 85.7%; local time rises 1.48% and allocation 26.46%.
Block scanning performs its own payload ownership/proof construction, whereas
the query comparator receives prebuilt proof responses. RPC answers in this
benchmark are in memory: no network latency, HTTP serialization or server proof
CPU is simulated. The block scanner's measured operation starts at the selected
height, excluding earlier empty bootstrap heights; real startup catch-up is
included in future network measurements. These repeated checks are not newly
executed business transactions or TPS. Real network benefit remains unmeasured.

[Raw interleaved samples, binary SHA, source SHA and exact input paths](evidence/block-scan-comparison-20261017.json)
retain the tradeoff. Reproduce:

```sh
GOMAXPROCS=1 YNX_CHAIN_BLOCK_SCAN_WINDOW="$PWD/artifacts/chain-network-performance/window-oJZYQJ" \
  nice -n 10 go test -p 1 ./cmd/ynx-consensus-perf-client -run '^$' \
  -bench '^BenchmarkBlockDiscoveryConfirmation$' -benchtime=150ms -count=3
```

For the interleaved order, use the retained `block-scan-client.test` binary with
`-test.bench='^BenchmarkBlockDiscoveryConfirmation$/^tx-query$'` or
`.../^block-scan$` in the six recorded positions. Setup and current-store
reconstruction are excluded equally from timed operations; actual fresh reads
and native signatures are not excluded.

## Validation and next network gate

Tests cover forged quorum, changed payload/BlockID, wrong result height/count,
missing/oversized execution results, transaction/byte/height limits, read-only
retry, publication lag, owned cache under caller mutation, late ACK timestamps,
changed current store, eight-height catch-up, 16-block eviction and cancellation.
A valid signed nonce-2 payload with a genuine fixture-signed inclusion header
and RPC code zero is rejected because actual durable execution only contains
nonce 1. Its effective business inclusion and final counts remain zero.

Full client tests PASS 3.735 s; scanner/ready/grouped/paced race PASS 6.017 s;
runner prepare-only tests PASS 988.690 ms. Raw source/test digests and logs are
in [source evidence](evidence/block-scan-source-20261017.json).

Next prepare one combined ready-pool/block-scan candidate with 256 senders ×
four nonce cycles = 1,024 transactions, configured maximum pace 512/s, under
the original 10 s client / 45+15 s / 1 GiB / 32 MiB resource caps. Any actual
run needs a fresh exact Root grant and admission checks. Ready-account waits
may underfill the configured pace; report actual offers, valid business
inclusion, final commits and all failures. This is a larger bounded regression,
not ten-minute 1,000 TPS qualification. Long streaming limits, 16 MiB durable
readback/history growth and full-state hash/validation scaling remain work
under the original performance goal.
