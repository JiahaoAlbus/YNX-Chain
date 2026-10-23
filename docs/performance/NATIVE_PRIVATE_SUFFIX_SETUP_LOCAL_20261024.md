# Native private suffix initialization, 2026-10-24

Source ebe2733397c4ab42708efcbf4977c8eb2762bec4, internal tree d59bc9b6f2c7bd486f25f973f6c974572d875033.

The verified39982425900 pair measured suffixSetup249.103ms/5calls on native8. Each call used NewApplication, which fully validates migration twice (directly and inside CanonicalJSON), privately JSON-clones migration, allocates a genesis committed state, then immediately overwrites that state with already reconstructed and fully validated private history.

The native opt-in suffix path now uses newSuffixApplicationForValidatedPrivateState. It runs CanonicalJSON with complete migration validation on every call, JSON-clones all migration data, selects the same first active fee recipient and installs the same privately validated state. It removes the duplicate validation and discarded genesis allocation. The original full decoder, JSON-prefix control and node writer remain unchanged. Full private committed-state validation, all signature/execution/nonce/fee/quorum/persistence checks remain; no mutable migration is shared across calls.

Focused tests compare complete Application equality to NewApplication followed by original state replacement, verify mutation isolation and invalid migration hash/balance/voting power rejection. Actual signed native prefix history still matches JSON control, rejects duplicate nonce/malformed input/corruption and restarts. Original five prefix negative/rotation/cancellation/certificate tests were rerun via the existing constructor-only native overlay under race; assertions unchanged. Focused PASS0.644s, original negative race PASS2.690s, complete client regression PASS10.601s. Original CI source gate repinned exact source/internal tree/delta;14PASS16.028s. The existing normal CI runs these package tests; benchmarks run only when explicitly selected.

## Local cost comparison

Original847001B migration SHA92b3040f1ac4aab8e4ab3163fa7132af772ea8ad22d5caaed72c98fb37981b94,2055 accounts. AppleM4/darwin-arm64/go1.25.7/GOMAXPROCS1/GOGC100/GOMEMLIMIT160MiB. Constructor only,8iterations/sample, fixed ABBA; excludes fixture read/setup and committed state validation shared by both modes. It does not measure node throughput or actual finality.

| Order | Mode | ms/op | bytes/op | allocs/op |
|---|---|---:|---:|---:|
| 1 | control-A | 10.844146 | 5848311 | 34982 |
| 2 | candidate-B | 9.569109 | 4401604 | 24698 |
| 3 | candidate-B2 | 9.792115 | 4401633 | 24698 |
| 4 | control-A2 | 11.039052 | 5848311 | 34982 |

Mean time change -11.525%, allocation bytes -24.737%, allocation count -29.398%. Only two samples per mode; no statistical confidence or conversion into network TPS is claimed.

First explicit benchmark failed opening a relative fixture path (Go package working directory); original failure retained. Corrected to the exact absolute original fixture. A preliminary ABBA overlapped this owner's race compile; all results are preserved separately in machine evidence. The reported ABBA ran after those processes completed, with no simultaneous benchmark from this owner. No claim about machine-wide isolation is made.

Reproduce from this worktree:

```sh
GOMAXPROCS=1 GOGC=100 GOMEMLIMIT=160MiB YNX_SUFFIX_MIGRATION_FIXTURE='/Users/huangjiahao/.codex/worktrees/chain-performance-20261017/YNX Chain/artifacts/chain-performance-20261017/shared-work-phases-source/bound-migration.json' go test ./internal/consensus -run '^$' -bench '^BenchmarkPrivateSuffixApplicationOriginalMigration$' -benchtime=8x -benchmem -count=1
```

[Machine evidence](evidence/native-private-suffix-setup-local-20261024-actual.json) pins every source/raw/fixture. New candidate is locally validated, not network validated or deployed. Next: normal exact-head CI; freeze an explicit same-VM old/new initializer comparison retaining native8/four observers, then obtain a new Root pressure1 once-only window with unchanged safety/resource caps. No new dispatch has occurred and no old grant is reusable. Sustained1000 effective final TPS for10minutes and finalP95≤3s remain unachieved.
