# Same-control four-node comparison: frozen controls

The before variant has since completed; see [its measured result](SAME_CONTROL_BEFORE_20261018.md). The cached variant remains unexecuted.

The matched comparison is frozen at
artifacts/chain-performance-20261017/same-control-comparison-pyU7WH.
All known binary bytes were freshly hashed before copying and after copying;
old frozen images and chain databases were not changed. This preparation starts
no Go build, fixture, node, port, signed workload or native fork probe.

Both actual prepare-only CLI invocations passed with identical caps and flags.
Eighteen Node control tests passed in1,506.332ms, covering optional terminal/slot
plans, invalid combinations, unchanged resource bounds and full/fast native
sampling. Fast samples omit only host enumeration/fork; real kernel RSS and
native normal-pressure gates remain. Full samples also require a complete host
enumeration and successful real fork. Probe timeout remains1,500ms and single
flight. The arbitrary parent is recorded as excluded from owned job RSS, matching
the corrected light controller rather than charging the shared app-server.

| Component | Before | Cached |
| --- | --- | --- |
| Client source | fff2ff67 | a8bf5177 |
| Client SHA256 | 72a3904601321263cb8f7a1b932944e4bffda40f74e81fdd759bfba26b8f09b8 | c6f5b051ce53a97afd89f2abacc8e5c211c50b941b37603174dfee3db4c4a212 |
| Node App SHA256 | ed2e8403ff1be729330534207cb0af75236fc80cac4ef368b36fe91d2474b79d | same |
| Fixture SHA256 | ee04f25ea40f0bd0f075a3a801cf9b0e216a841578e3da2fa28b244f241d35e1 | same |
| Native pressure probe | 3025b7f5bac1220e18cac1e9e14051553d918348df07873f392f33c700ba3cc6 | same |
| CometBFT v0.38.23 | 60d991c4fe429e6fe942ebbcb7447a059328c6bcafbe9b09acd263db658bd840 | same |
| Frozen controller | 457b18d5f0d1e38bebb6f69ed384f09d2f260fe7956ed120ef0841f735bd8d90 | same |

Each run uses256 isolated fresh senders, four nonce cycles,1,024 unique signed
inputs, configured max offer512/s, ready-pool scheduling, authenticated block
scan and V2 block-journal state. Terminal streaming and result-slot reuse are
**off** for both, to isolate the earlier measured replay-verification-facts
change. These existing binaries are reused intentionally; the later c686 slot
CLI needs its own scheduled main-binary build and network verification.

The network job retains45s active+15s cleanup,10s client,1GiB actual owned/control
RSS,32MiB local data,320 threads,9 long-lived children,4 submitters/4 observers,
GOMAXPROCS1 and the existing disk floor/reserve. Standard Go runtime defaults
GOGC100/GOMEMLIMIToff are now explicitly pinned for both workloads, rather than
inheriting a compiler-test environment. This is the original network resource
policy, not the separate400MiB light-test job or its GOGC50/160MiB soft limit.
No cap is increased and no network grant is implied by preparation.

[Complete frozen paths, helper/image hashes, both verified prepare-only plans
and exact argument vectors](evidence/same-control-comparison-prepared-20261018.json)
are retained. Preparation JSON SHA256 is
 d60939a22471cacf7e7c70cf203ed93dda7202447e006f4449828fefda9d3ff3.
Fresh disk at preparation was44,275,658,752 bytes; admission must recheck actual
resources and all12 loopback ports before any eventual run.

Reproduce preparation without starting any workload:

```
node scripts/loadtest/prepare-known-client-comparison.mjs
```

Each variant's argvPrepareOnly needs a **separate fresh Root grant** before
adding --execute. There is no automatic second run, rerun on timeout, limit
change, existing database reset or resubmission. Every actual result must retain
firstCause, cleanup and per-transaction outcomes. UNKNOWN identities remain
retired for read-only reconciliation only.

These are the same configured workload policy and runtime controls, not
byte-identical random fixtures across runs. Root must reserve comparable host
conditions; block packing, drain and sample size still affect inference. The
historical116.056/s RWY2KW run and failed1ZsLDk window are not this new matched
pair, and no network speedup is claimed yet. Completed windows require actual
fee/nonce readback, publication/quorum/Merkle checks and offline signed-block
replay. Latencies remain client monotonic observations with polling overhead.
This bounded comparison cannot establish the ten-minute1,000TPS objective.
