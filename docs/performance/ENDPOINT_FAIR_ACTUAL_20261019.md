# Endpoint fairness: finite actual comparison, not accepted for promotion

Run `39154351784`, source `5fd8422d4da5a50769698e98dd74181240a66881`, completed successfully. Both cases used the same Linux VM, four compiled node binaries, gRPC ABCI, 512 senders × 2 rounds, four submitters/observers, configured offer rate 512/s, bounded cadence, shared durable replay and observer phase measurement. Only endpoint fairness changed. The source reader checked case/client SHA256, original transaction rows, business gates, source/compiler/binary identity and terminal receipt. Both cases had 1024 valid included and qualified final transactions, no UNKNOWN, rejection, timeout or execution failure.

| Actual metric | Shared baseline | Fixed one worker per endpoint |
|---|---:|---:|
| Full-window effective inclusion/final TPS | 237.708188 | 255.297399 |
| Actual offer interarrival rate /s | 322.412809 | 361.576038 |
| Offer → effective inclusion P95 ms | 1533.643507 | 1310.847750 |
| Offer → qualified final P95 ms | 1747.784212 | 1458.530591 |
| Offer → qualified final P99 ms | 1826.271100 | 1506.034521 |
| Submission queue P95 ms | 11.494642 | 49.227146 |
| Submission queue P99 ms | 33.739908 | 274.823061 |
| CheckTx RPC P95 ms | 18.840955 | 10.164621 |
| CheckTx RPC P99 ms | 42.138339 | 39.934188 |
| Peak pending submission | 15 | 51 |
| Sampled owned RSS bytes | 565940224 | 583008256 |

Finite final rate improved 7.3995% and offer-to-final P95 improved 16.5497%, but submission queue tails worsened. `finiteJointAndTailImprovement=false`; fairness remains default off. This is one fixed-order 1024-transaction pair, with fresh fixture identities and startup/cache order differences. Neither sustained throughput nor 1000 TPS is qualified. The prior shared-replay pair's 314.25 TPS belongs to that pair and must not replace this pair's baseline.

## Actual adverse interval

Candidate row 699 waited 286.310819 ms for original endpoint `127.0.0.1:31760`. At its recorded offer timestamp, reconstructed submission/CheckTx intervals show only row 659 active, at that same endpoint (65.558906 ms RPC). The other endpoints' maximum queue delays were 32.506614, 38.596041 and 42.548011 ms; endpoint 31760 reached 286.310819 ms. This supports inspecting fixed endpoint worker capacity and local scheduling. It does not independently identify server locks, GC or network as the cause: interval reconstruction uses UTC rows rather than an atomic worker snapshot.

The original four submitters and index%4 endpoint authority are preserved. No blind network rerun or default promotion follows a safety-green workflow. Next source instrumentation adds optional monotonic HTTP boundaries to the existing submission call under `-observer-phase-timing`: connection acquisition, request-write hook, first response byte, and callback return. Actual hook counts and absent hooks remain explicit, including UNKNOWN. The measurement does not add a request or retry, and has no new network performance claim. The existing original CI package test automatically covers the new tests.

## Receipt and recovery

Actual post-fsync terminal: qualified, firstCause null, 14060 ms, 44604613 retained bytes; pair receipt 955230 bytes, SHA256 `3e4860f4f7d3a15266f09c1641d0b5e6c39cdf0ef97e30aeb280218b8c928d28`. Both cases cleaned up; two closure scans after each case contained only the original launcher. Root independently confirmed and returned the heavy slot to Wallet before full analysis.

Artifact 12146641619 (11755237-byte ZIP): selected members recovered using bounded exact HTTP 206 ranges, checked against central-directory CRC and size, then bound by SHA256 to the original case/pair receipts. This is not a complete ZIP digest verification. Before/after transaction files are 3341848/3196007 bytes with SHA256 `5d4fa2c4745cbaf7512e468b4d458bcc0b11c397db0dc47e7a89e12d1d79a0f9` / `6c2dcb4b55b69bc66f857a161801a600420e50ba845d519397c23a01ffe51c7d`.

Committed compact actual evidence: [endpoint-fair-pair-ci-39154351784-actual.json](evidence/endpoint-fair-pair-ci-39154351784-actual.json). Original raw, all bounded observer traces and full recomputation remain under `artifacts/chain-performance-20261017/endpoint-fair-pair-39154351784/`; full original CI log is in the sibling `endpoint-fair-pair-source/` directory. These artifacts are not rewritten by the compact report.
