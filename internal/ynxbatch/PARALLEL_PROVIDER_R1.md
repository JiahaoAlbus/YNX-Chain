# Fixed-suite bounded parallel provider, R1

This is an opt-in source candidate. Default signing and verification remain
sequential. No measured speedup, activation, throughput or finality is claimed.
The cryptographic suite and YNX-BATCH/v0.1 bytes remain unchanged.

`NewParallelProvider(capacity)` creates an explicit shared instance, accepting
only capacities 1 through 4. One operation runs ML-DSA-87 on one extra goroutine
and SLH-DSA-SHA2-256f on its caller. At capacity the caller runs the two branches
sequentially; no operation waits to join a future transaction or queue. The cap
bounds additional goroutines, not pre-existing caller load or total machine CPU.
There are no global pools, resident workers, automatic mode changes or altered
GOMAXPROCS. Applications must reuse a single instance for the intended budget.

`SignOptions.ParallelProvider` consumes this instance in the existing BatchSign
entry point. Nil uses the original sequential order and first-error behavior.
The private-key mutex remains held through both branches, join and output
assembly. Aliases share that mutex; Destroy cannot clear a key mid-signature.
Enabled operations join both branches and prefer the original A error if both
fail. A failed operation returns no Batch or signature slices; detached temporary
signature buffers are cleared. This is not a secure-memory-erasure guarantee.
Upstream panics are joined then rethrown on the caller before its key lock is
released. No panic or branch failure becomes success.

Verification always evaluates the real ML and SLH branches with empty context,
complete original branch-domain messages and exact fixed algorithm parameters.
It returns success only after both complete. Trusted registration and both Merkle
paths remain the existing Verifier's responsibility. This scheduling choice must
never cache failed certificates or bypass the current policy/height checks.
`VerifierOptions.ParallelProvider` is now connected to the original NewVerifier,
AuthenticateCertificate, VerifyWhole and VerifyOne paths. Zero-value non-nil
providers are rejected by both signing and verifier construction. No cache entry
contains an alternate authorization result; parallel and sequential execution
authenticate identical complete bytes with the same fixed suite.

The provider's private entropy helper exists to exercise actual upstream SLH
random-source failures without replacing process-global randomness. Production
always supplies crypto/rand.Reader; callers receive no entropy/provider callback
option. Consensus durable HRS/sign-state files and ynxconsensusauth are unchanged.
This primitive is not a replacement consensus signer or Wallet permission gate.

Baseline source blobs before this slice:

- provider.go: `4fd7f6a20f2baabd69381c4f90185d1b2423b23e`
- sign.go: `d4925980c41631402ed2eff351e69530ce6460bc`
- verify.go: `d4c4ac7e8923a1e2e3fc7b0460839b390d14a414`

New source tests include real sequential/parallel signatures, each invalid
signature branch, bounded saturation, joined panic propagation, actual upstream
entropy failure with no partial output, original Destroy synchronization, aliased
key races and concurrent real verification. Unit scheduling barriers do not count
as cryptographic or throughput evidence.
Production-entry regression checks include failed A/B certificates leaving the
success cache empty, real cold signature count 2, warm success count 0, rejected
second-tree tampering after a cache hit, and current-height revocation rejection.

Root's normal remote CI should run the focused package and bounded benchmark:

```sh
go test -p 1 -count=1 ./internal/ynxbatch -run '^TestParallelProvider'
go test -p 1 -run '^$' -bench '^BenchmarkParallelProvider' -benchtime=10x -benchmem ./internal/ynxbatch
```

Benchmarks compare real fresh N=1 signing, valid and invalid-A/invalid-B
verification, and a fixed four-caller load with independent signing keys.
Each verification iteration creates a fresh production NewVerifier and invokes
VerifyOne with caching disabled, including complete member parsing, key import,
current trust and both paths on valid input. Invalid A/B cases must still report
two real signature checks. Signing measurements call the original BatchSign.
They report observed parallel operations, serial fallbacks and peak extra workers
alongside time/allocations and GOMAXPROCS. Sign benchmarks generate fresh random
batch IDs/signatures on every iteration; key generation and final result checks
are outside timing. Concurrency results must be considered alongside isolated
latency. A favorable isolated result alone does not justify enabling the option
on already CPU-saturated application paths. No local Go/C build or test was run.
