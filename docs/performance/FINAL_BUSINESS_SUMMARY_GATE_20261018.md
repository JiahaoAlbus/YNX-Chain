# Use the same final-business gate in both report retention modes

Full-history `summarize` previously counted final submission from quorum/proof,
confirmation timestamp, a durable-state boolean and journal publication. Unlike
the existing slot-retained cumulative summary, it did not additionally require
code-zero business execution, positive inclusion height, durable height covering
that height, a snapshot digest, confirmed terminal status or an authenticated
code-zero CheckTx response. Its confirmation latency distribution accepted any
non-nil duration, regardless of these final-business gates.

The existing strict predicate is now named `qualifiedBusinessFinal` and shared by
both modes. Full-history final counts, full-window final rate and final latency
samples use that predicate. Raw submission, ACK, quorum and authenticated
inclusion stage observations remain separate. No consensus or persistence code
changes and no additional RPC calls are introduced.

The existing complete-evidence unit fixture is corrected to explicitly contain
height/digest/status. Eleven mutation subtests exercise missing/failed execution,
missing snapshot, insufficient durable height, zero inclusion height, unauthenticated
or rejected ACK, timeout status, absent final timestamp and incomplete journal
publication. A mixed good/bad report must contain only one final sample. These
Go test sources are formatted but not yet compiled/executed; the previous Root
window was refused before Go on memory pressure 2 and is not reused.

## Readback of a retained actual network result

A Node offline field re-evaluation of the original unmodified
`window-eEfGE7/transactions-result.json` verifies all 1,024 reported transactions
satisfy the stricter field predicate. Final count/rate and latency stay:

| Metric | Original report | Strict field re-evaluation |
| --- | ---: | ---: |
| Final transactions | 1,024 | 1,024 |
| Final transactions/full-window second | 135.5765762138212 | 135.5765762138212 |
| P50 final ms | 1176.174834 | 1176.174834 |
| P95 final ms | 1767.879958 | 1767.879958 |
| P99 final ms | 1851.966167 | 1851.966167 |

Five independently altered copies of one original row demonstrate that the old
field predicate would count missing snapshot, lagging height, failed execution,
unverified ACK or timeout as final. The shared stricter predicate excludes each.
The original artifact remains untouched. This Node check is a field-level audit,
not Go runtime testing, renewed signature verification, state replay, a fresh
network run or a performance gain. Raw source SHA and results are in
`evidence/final-summary-gate-readback-20261018.json`.

Next requested Go selector, combined with the pending supply checks when Root
schedules a fresh bounded light window:

```sh
GOMAXPROCS=1 GOGC=50 GOMEMLIMIT=384MiB go test -p 1 \
  ./cmd/ynx-consensus-perf-client \
  -run '^(TestReadySenderFastAccountAdvancesBeforeSlowPeer|TestReadySupplyRejectsUnknownBeforeSigning|TestFinalSubmissionRequiresDurableEvidenceAndHonestCounts|TestFullHistoryFinalCountsAndLatencyRejectIncompleteBusinessEvidence|TestReadySenderCumulativeCountsMatchCompleteHistoryAfterOutOfOrderHandoffs|TestJournalFinalCountsAndSenderGateRequirePublishedView)$' \
  -count=1 -timeout=30s
```

This is a proposed focused recipe, not authority to start another Go window.
The 2,048-input, 32-nonce and short-window driver limits remain unchanged; they
must be addressed through bounded streaming and production history/storage work
before any 600,000-transaction ten-minute acceptance. Raising constants alone
would not establish capacity or safe resource use.
