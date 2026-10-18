# Original observer phase measurement, 2026-10-19

Actual single Linux four-node run39145119313 at1a071fe7ab021e3e9535ea12395df40b97d968af completed successfully. All1024 transactions passed business inclusion, quorum, current durable readback and published Info checks. Zero UNKNOWN, timeout, rejected or execution-failed outcomes. Cleanup completed. This is a finite diagnostic case, not sustained1000TPS and not a matched before/after comparison.

The complete4.964093361s window yielded206.281374 qualified finals/s; actual offer rate255.675131/s. Offer-to-inclusion P50/P95/P99 was1322.269/1876.254/1996.253ms; offer-to-qualified-final was1551.303/2191.577/2280.489ms. Accepted-waiting-observation peaked512. Supply wait854.566ms and drain960.897ms include original confirmation/nonce dependencies.

Original call timing:143 block queries accumulated3374.519ms;23 durable business batches3349.926ms including4 not-ready attempts;24 block-result queries887.816ms;24 quorum checks3.432ms. Reader load2898.813ms includes decode/replay2770.317ms, capture110.570ms, hash6.966ms and index publication9.315ms. Transaction checks separately accumulated450.426ms. Reader19 complete validations and4 path-local cache hits replayed75 blocks and11614 transaction inputs. Native cryptographic fact hits10575 already avoid most repeated signature work.

Each node completed6 Commits, averaging4.082–5.919ms. Per-node cumulative delta encoding0.633–0.959ms, write0.600–0.783ms, fsync2.422–6.171ms. Thus this short case does not support making Commit encoding/fsync the first optimization. Duplicate complete durable replay is the next owning source hypothesis; preserve all current file and publication checks.

These are original-call wall durations including scheduling/server/transport waits. Workers run concurrently; durable business batches contain reader load and transaction checks; reader load contains its child phases. Never sum nested scopes or parallel worker totals into BFT latency. Trace1024 rows is explicitly capped; totals cover all calls and match original counters exactly. The9808 accumulated per-transaction pending observations comprise9404 block-not-yet-observed plus404 local durable-height-not-ready, not9808 RPC failures or failed final transactions.

Actual owned peaks:580751360B RSS,64 threads,21197667B private data; wrapper7555ms. All original caps remain unchanged. No next network run is authorized by this document.

Canonical readout: [actual evidence](evidence/observer-phases-ci-39145119313-actual.json). Selected ZIP members were recovered by exact HTTP206 and verified by uncompressed size/CRC and individual SHA256; whole ZIP was not downloaded/hash-verified. Raw files remain under artifacts/chain-performance-20261017/observer-phases-39145119313/.
