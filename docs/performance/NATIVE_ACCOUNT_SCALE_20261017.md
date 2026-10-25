# Native account-table and hot-lot copy costs

The next load stage needs more independent senders: CheckTx deliberately accepts
only the committed next nonce, so a long run cannot queue unlimited speculative
nonces from a small account set. Before raising that population, these bounded
source probes measure native execution cost with larger account tables and dense
receiver/validator-fee lot maps.

Both probes use synthetic account tables and a real correctly signed envelope.
Static verification is primed once, then each timed branch performs the normal
nonce, balance, lot and fee execution from an unchanged input. Post-timing checks
verify the actual output balances/lots/fee count and input isolation. There is no
migration anchor validation, proposal, BFT, Commit or durable business transaction
in this measurement. It must not be converted to effective business TPS.

Apple M4, Go 1.25.7 darwin/arm64, `GOMAXPROCS=1`, nice 10, 100 ms per benchmark,
three repetitions. Runtime core remains `2f446351f`; these are new test-only
sources and do not alter frozen network binaries.

## Account-table growth

With one small lot map per account, median native execution costs were:

| Accounts | ns/op | allocated bytes/op | allocations/op |
| ---: | ---: | ---: | ---: |
| 256 | 6,959 | 26,400 | 22 |
| 2,048 | 28,789 | 182,052 | 22 |
| 8,192 | 111,502 | 722,730 | 22 |

The account slice is still copied on every native execution. The allocated
volume grows with total account count despite only three addresses changing.
[Raw measurements and source/binary digests](evidence/native-account-scale-20261017.json)
retain the original observed benchmark output values without rerunning to
replace observations around the network slot.

## Hot recipient and fee lot maps

At a fixed 2,048 accounts, give the receiver and fee account equal lot-map sizes:

| Lots per receiver and fee account | ns/op | allocated bytes/op | allocations/op |
| ---: | ---: | ---: | ---: |
| 1 | 29,732 | 182,052 | 22 |
| 64 | 32,819 | 188,628 | 26 |
| 256 | 42,880 | 208,852 | 26 |
| 2,048 | 153,424 | 400,071 | 38 |

At 2,048 hot lots the observed native operation is about 5.16 times slower than
with one hot lot. The fixture's IDs/balances are structural inputs, not a replayed
historical chain; absolute timings are not network predictions.
[All original hot-lot benchmark output](evidence/native-hot-lots-scale-20261017.json)
is retained.

Removing only the whole-account-slice copy would leave the hot lot-map copies.
The next source implementation should isolate sparse account **and lot** updates,
then materialize canonical maps only at proposal/action boundaries and sealing.
It must preserve deterministic traceable-lot selection, sender/receiver/fee
aliases, late-failure rollback, immutable sibling branches, mixed-action behavior
and exact durable state/AppHash. An immutable update structure is a candidate
design, not yet an implemented or measured improvement.

## Reproduction

From the performance worktree:

```sh
env GOMAXPROCS=1 nice -n 10 \
  ./artifacts/chain-performance-20261017/account-scale-before.test \
  -test.run '^$' -test.bench '^BenchmarkNativeAccountScale$' \
  -test.benchtime=100ms -test.count=3
env GOMAXPROCS=1 nice -n 10 \
  ./artifacts/chain-performance-20261017/account-hot-lots-before.test \
  -test.run '^$' -test.bench '^BenchmarkNativeHotLots$' \
  -test.benchtime=100ms -test.count=3
```

These source benchmarks started only after the real network window had returned
its heavy slot, or completed before that window started. They do not authorize a
larger network population or a sustained run without Root scheduling.
