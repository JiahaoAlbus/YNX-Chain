# Original Wallet signature provider microbaseline

This opt-in diagnostic measures the unchanged CIRCL v1.6.5 SLH-DSA-SHA2-256f
backend and its existing `ynxbatch.BatchSign` caller. It does not implement an
alternative signer, change provider scheduling, or authorize any integration.
The unified execution policy at `docs/engineering/YNX_EXECUTION_POLICY.md` applies;
Wallet/necessary Core only. All after/optimization work remains on hold.

## Reproduce

From this isolated worktree root, set an existing Go 1.26.10 executable, an
external private artifact root and a **read-only file module proxy**:

```sh
BASELINE_ROOT='/Volumes/西部数据/YNX-large-work/wallet-slh-original-baseline-20261031' \
GO_BINARY='/Users/huangjiahao/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.26.10.darwin-arm64/bin/go' \
READONLY_MODULE_PROXY='file:///Users/huangjiahao/go/pkg/mod/cache/download' \
YNX_SLH_BASELINE_SAMPLES=1000 RUN_LABEL=formal \
experiments/wallet-slh-provider/run-baseline.sh
```

Ordinary `go test` skips `TestSLHOriginalProviderBaseline` unless
`YNX_SLH_BASELINE_OUTPUT` is set. A four-sample capacity pilot passed before the
formal run; its percentiles are not precision/tail estimates. All Go build,
module, temporary, result and CPU-profile outputs use the external private root.
The file proxy is only read. `-mod=readonly`, `GOTOOLCHAIN=local`, `-p=1` and
`GOMAXPROCS=2` prevent lockfile changes, toolchain installation and compile bursts.
The runner records environment, protected source hashes, output and cleanup.
No network pressure or production accounts, input, Native/CABI, services or keys
are involved. Fresh synthetic keys remain in-process and are never serialized.

## Seven serial scenarios

- Original single SLH call, one or two independent synthetic-key callers.
- Original `BatchSign`, sequential dual signatures, one or two independent callers.
- Existing `ParallelProvider(2)` dual-signature pair, one or two independent callers.
- Existing pair provider, two callers sharing the same key and original mutex.

The pair mode is **already production source**, not a new optimization. It runs
ML-DSA and SLH branches; it does not parallelize one SLH signature internally.
Direct SLH retains `privateKeyState.mu` and calls the exact
`slhdsa.SignRandomized(s.b, rand.Reader, slhdsa.NewMessage(mb), nil)` backend with
a canonical CERT/B message prepared outside measurement. That message is reused
in the direct-backend case; each invocation still obtains the original randomized
R via `crypto/rand.Reader`. Batch cases call full `BatchSign` on a 256-byte N=1
message, `Optimized:true`, fresh internal random BatchID, canonical domain,
original key lock and both full signatures. FIPS pure-mode context is nil/empty.

Each caller warms twice, then submits 1,000 closed-loop operations. Each invocation
is timed using Go's monotonic duration, including any mutex wait. Raw samples have
caller and sequence identifiers. P50/P95/P99 are nearest-rank `ceil(p*N)` order
statistics of actual durations pooled across callers, not `ns/op` means. A 1,000
sample case has ten observations above its P99 rank; two-caller cases pool 2,000
samples. These are descriptive order statistics from one serial run, with no
confidence interval, open-loop demand or randomized scenario ordering.

Latency ends at return from `BatchSign`; detached wire clone and `Discard` follow
outside latency. Signing throughput is completed operations divided by wall time
of all caller loops, including small sampler, wire clone/discard and goroutine
join overhead. Every sampled signature is retained only as public bytes in memory
and verified by original production verification **after** the signing wall/CPU
window. A tampered SLH signature must fail for every scenario. Every key is
Destroyed after verification; original `BatchSign` must reject its destroyed
handle. Existing pair stats must show zero in-flight work after join.

CPU time uses process `getrusage` user+system deltas for the signing window;
CPU-core utilization is that CPU duration divided by wall duration, not percentage
of all ten physical cores. Allocation counts are process-wide runtime deltas;
profile/sampler overhead and concurrent runtime activity are included. CPU profiles
are enabled during every signing window, so these are **profiled baselines**.
Verification/keygen/warmup and profile flush are excluded from the measured window.
CPU-profile coverage also includes the small sampler setup between warmup and
caller release (memory/CPU snapshots and caller creation), and snapshots after
caller join. It excludes key generation, template creation, warmup, verification,
tamper checks and Destroy. Profile percentages describe this sampling scope and
must not be interpreted as isolated algorithm-cycle shares.
The macOS `time -l` process peak RSS covers the full `go test` invocation, including
verification/tooling, not just the signing window. No energy measurement or physical
secret-erasure guarantee is claimed; `Destroy` has the existing documented Go and
upstream allocation limitations.

This is a local signer microbaseline. It does not establish wallet authorization,
Native/device behavior, build/install/release readiness, chain TPS, inclusion,
finality, energy, side-channel safety or cross-provider interoperability. There
is no after result and no performance improvement claim. Future comparisons must
match hardware, CPU features, compiler, provider/caller source identity,
GOMAXPROCS, message length, context, entropy, profile mode, load and key sharing.

The performance samples intentionally use fresh randomized keys and R. Their
exact public key and additional-randomness stream are not replayable: no private
key is exported and no random-reader replacement is used. A future after run
must use the same sampling design. This run is **not** same-key/same-R bytewise
differential testing. Public-seed vectors and cross-provider equality/verification
belong to a separate correctness gate, without changing global randomness or
production entry points. In particular this Core `56f04dae...` baseline does not
exercise this round's Native/Main/Keychain/source-authorization `8716744` candidate.
Constant-time behavior, side channels, energy and physical erasure were not tested.

The formal run completed 11,000 sampled operations in seven passing scenarios.
All outputs verified, all tamper checks rejected, all destroyed handles rejected;
provider in-flight counts returned to zero and goroutine counts matched before
and after join. Shared desktop activity (notably Spotlight and browser/UI work)
was present; the machine was not isolated. Do not interpret between-case latency
differences as optimization gains. Full raw samples and profiles are external at
`/Volumes/西部数据/YNX-large-work/wallet-slh-original-baseline-20261031/results/formal`.
An independent Go reader rechecked integer nearest-rank percentiles, throughput,
unique caller/sequence counts, verification totals and cleanup for all samples.
Its result is `independent-summary.json`, with per-caller P95 as well as pooled
P50/P95/P99. A Python analysis process exited 137 without stderr; the reason was
not established and Python was not retried. No signer sample depended on Python.

| Original caller | Callers / key sharing | N | P50 ms | P95 ms | P99 ms | ops/s | CPU cores |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SLH only | 1 / independent | 1000 | 19.891 | 22.259 | 32.493 | 48.563 | 0.987 |
| BatchSign sequential | 1 / independent | 1000 | 20.859 | 27.544 | 42.191 | 45.453 | 0.975 |
| BatchSign existing pair | 1 / independent | 1000 | 20.977 | 22.669 | 30.796 | 46.765 | 1.006 |
| SLH only | 2 / independent | 2000 | 21.247 | 23.384 | 26.210 | 92.415 | 1.990 |
| BatchSign sequential | 2 / independent | 2000 | 21.566 | 23.181 | 25.699 | 91.705 | 1.988 |
| BatchSign existing pair | 2 / independent | 2000 | 21.333 | 22.672 | 24.226 | 92.903 | 1.997 |
| BatchSign existing pair | 2 / shared | 2000 | 42.954 | 67.334 | 76.559 | 46.555 | 1.006 |

The original per-key mutex is a visible concurrency boundary: two independent
keys consume about two CPU cores, while two callers sharing a key remain around
one core and exhibit queueing latency. This is a source-supported interpretation
of this microbaseline; no mutex or scheduling behavior was changed. Single-SLH
CPU profiling attributes 73.45% cumulative samples to `htSign` and 18.68% to
`forsSign`; these cumulative percentages overlap with their child functions and
must not be added to those children. `sha256.blockSHA2` and `sha512.blockSHA512`
are present in the actual profile. The whole test invocation took 185.88 seconds
wall time and reported a peak RSS of 272,793,600 bytes; sampled signing windows
and process CPU deltas are recorded separately per scenario.
