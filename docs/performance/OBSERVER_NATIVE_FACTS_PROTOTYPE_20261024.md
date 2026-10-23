# Observer native signature fact reuse: isolated prototype, 2026-10-24

Production remains exact0c6f2ad54 and its once-only suffix run39989248490 does not include this overlay. No production API, CLI, report/controller mode or default promotion has been made for this prototype. Next owning implementation must be explicit and include the negative cases below before normal CI/network qualification.

The completed suffix run measured original observer transaction verification759.669ms/2048inputs (control),568.212ms/2048(candidate), while original replay already cryptographically checked each signed native envelope. The original private replay cache stores only successful immutable signature facts keyed by chainID+SHA256, compares full original bytes, and is bounded to4096entries/4MiB retained string bytes. It contains no execution authorization.

This overlay adds a lookup-only API. Caller supplies expectedChainID; it must equal the decoder's private migration chain. Only existing exact bytes+chain facts are returned by value. Misses run the original DecodeSignedTransaction+Verify. Every call still checks current already validated state initialization/height, exact transaction hash+payer+fee+kind+execution-height fee membership, nonce and context. The API never populates the cache and never mixes observer hits into original replay counters. It does not change slot freshness, file hashes, Merkle/quorum/publishedInfo verification or block execution.

## Real RED and correction

The initial API used only decoder chain binding and omitted explicit observer expectedChainID. A new negative intentionally changed reader migration chain after the genuine2048-envelope replay: old overlay wrongly accepted a cached original envelope. Actual RED is preserved in cross-reader-chain-red.raw, test failure `prototype reused signature across reader chain binding`, exit1/1.356s. This defect was confined to the unmerged overlay.

Correction adds expectedChainID to API and call site, rejects mismatch before lookup, then retains original full signature verification on miss. The exact same cross-reader negative now passes along with absent fee, absent nonce, wrong execution height, changed envelope, cancelled context and returned-value mutation checks. Separate nil/cold/bounds/different chain/SHA-key with different canonical bytes/concurrent immutable reads/eviction tests pass under race1.608s. Eviction-only synthetic private entries exercise original capacity; they are not cryptographic successes or business transactions.

## Local measured phase

AppleM4/darwin-arm64/go1.25.7, GOMAXPROCS1/GOGC100/GOMEMLIMIT160MiB. Each fresh sample first fully replays the original journal with2048 unique actual signed transactions and builds original fee/nonce indices. Replay successful mathematics count2048 remains unchanged before/after observer phase. The observed phase runs original verifyTransactionLocked for every original input with original exact execution height. It excludes original file freshness/capture/state-validation/HTTP/quorum/finality; it is not whole reader or network TPS.

| Order | Mode | Phase ms | Allocated bytes | Observer fact hits | Per-input transaction checks |
|---|---|---:|---:|---:|---:|
| 1 | control | 189.922709 | 7964088 | 0 | 2048 |
| 2 | observer-fact-reuse | 1.240375 | 425984 | 2048 | 2048 |
| 3 | observer-fact-reuse | 1.035417 | 425984 | 2048 | 2048 |
| 4 | control | 189.460375 | 7964088 | 0 | 2048 |

Measured phase mean−99.400% wall/−94.651% allocation. This large local difference removes duplicate mathematics only after2048 actual original signatures were fully verified; it cannot be projected as a network throughput multiplier. Four finite fixed-order samples do not establish statistical confidence. Initial common-chain positive samples and prior unbound API/race outcomes are preserved separately and are not the corrected-source qualification.

[Actual machine evidence](evidence/observer-native-facts-prototype-20261024-actual.json) pins fixed source, original weak source snapshots, raw RED/PASS/timing outputs and actual2048work counters. Fixed API/caller/test/race-test code snapshots are saved alongside as `observer-facts-*.go.txt` for Go overlay use, so ordinary Go package discovery cannot compile them as production. The RED test snapshot is reconstructed by inverting only the added expected-chain lookup arguments in the fixed test while retaining the new cross-reader rejection assertion; pair it with the preserved original weak API/caller. It is explicitly labeled reproduction source, not a claim that the reconstructed file was the original saved test artifact.

Next implement an opt-in production observer-facts path with explicit mode/config binding and separate actual hit/miss/fallback-math counters, propagate complete signature/state negative tests and existing recovery/rollback invariants, qualify normal exact-head CI, then seek a new Root window. Original native suffix control stays the baseline because its completed real network candidate failed joint performance acceptance. Sustained1000 qualified final TPS/10minutes remains unachieved.
