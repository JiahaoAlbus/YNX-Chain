# V13 borrowed-default recovery candidate

This independent unpublished `1.13.0-source-candidate.3` binds source/kernel commit `78071d90b4be0883849b420290d70a74651bdabc` and complete internal tree `42b2289a323fd487e4d62a76de0845abcb66ec79`. State schema 13, `YNX_ABCI_STATE_V13` and ABCI application 19 are unchanged. This is source recovery and an inactive experiment, not a protocol upgrade or performance promotion.

The public `hashCommittedStateDocument` always calls the original borrowed-buffer encoder for every fee-history length. The revised fee-chunk implementation is reachable only through explicit direct parity tests and the named experimental benchmark. The checker inspects this exact public function body and requires the benchmark to call the distinct experimental function. `candidateActivation` must state borrowed default, direct-call/benchmark-only experiment and automatic activation false.

The preceding candidate.2/f134 and its nine files, guards, failure records and measured pair remain frozen. Actual matched run 39114847427 on source 2509fd6/f134 had three samples per mode. Median original values were 1,321,967 ns/op and 76,993 B/op; the first experiment was 2,065,477 ns/op and 511,707 B/op: 56.24% slower and about 6.65 times the allocated bytes. This negative result is retained as a regression with activation withdrawn. The revised experiment is unmeasured; reverting the default is not a speedup claim.

`check.mjs` exports `SOURCE_COMMIT`, `INTERNAL_TREE` and `validateCandidate({repository})`. Its immutable Git reads preserve all 23 original consumed inputs and all three published predecessor pins. Three kernel leaves are separately pinned in `kernelDerivation`; the complete internal tree is independently checked. All 71 predecessor vector specifications, five original candidate boundary vectors and inherited capability assertions remain. Original negatives are preserved, with additional recovery-activation and prior-negative-evidence rejection controls. The normal checkout guard checks current mapped/kernel bytes, complete HEAD internal tree, dirty tracked and untracked internal inputs. No default fallback, branch lookup or generic source approval is added.

```sh
node /absolute/path/perf-state-v13-borrowed-recovery/check.mjs --repository /absolute/path/repository
node --test /absolute/path/perf-state-v13-borrowed-recovery/check.test.mjs
```

The normal Perf receiver is `scripts/verify/perf-v13-borrowed-recovery-integration-check.mjs`. The original Perf owner alone selects its Make/CI target and retains the preceding targets. No separate derived CLI is needed.

Before this candidate was frozen, original source CI 39115542457 ran full unfiltered consensus and ABCI Go tests successfully. Original canonical byte/hash, late error, framing, short-write, real 512 signed-transfer, restart, replay and audit checks were retained; nested-name, escaped-value, whitespace and malformed-tail checks were added. Its full run remained failure at the preceding fixed f134 identity gate. The formal equivalence proof and raw log are retained in the handoff. This Node checker itself runs no Go, signatures or restart; its `goRuntimeTestsRun` stays false and candidate packaging/deployment/signing flags stay false.

The inherited v12 disk-loader hash-before-upgrade, empty new DEX collections, exact v13 state-sync, trusted external AppHash, replay and independent checkpoint boundaries remain. Protocol V15/V16/V17 is separate and not interchangeable. Suspended products receive no new runtime testing or activation from these inherited static contract checks. Original published metadata and tags are unchanged.

`SHA256SUMS` covers the complete nine-file candidate inventory and is pinned by the normal guard. SDK318 and IDE source selections are not changed. New full CI, controlled same-input measurement and any deployment qualification remain separate gates.
