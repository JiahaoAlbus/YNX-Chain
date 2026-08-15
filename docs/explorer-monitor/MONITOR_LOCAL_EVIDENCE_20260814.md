# Network Monitor local evidence — 2026-08-14

Implementation checkpoint: `0d0a6facc`

Commands:

```text
cd apps/monitor
npm test
npm run build
```

Result: 36 TypeScript server/UI tests and 5 publisher/supply-chain tests passed; the production Vite build completed. The capacity test recorded 1,000 requests at concurrency 25 with zero failures, 591.9 requests/second, p50 17.681 ms, p95 138.422 ms and p99 289.060 ms.

The signed public source/projection contract is v2. It includes bounded service identity, checked/start times and dependency states for RPC, Indexer, Explorer, Faucet and Gateway. Missing identity remains null and renders as unavailable. The parser continues to reject tampering, replay, stale/unapproved snapshots, unknown fields, private paths and fake healthy summaries.

The authenticated network projection derives four-validator coverage, heights, canonical indexed finality, index lag, block interval, TPS, peer count and sync state only from current bounded probes. It strips configured endpoint URLs and raw errors before returning browser data. StreamBFT is always labeled `shadow/candidate` with `active:false` in this release.

Public trend samples are derived only from accepted signed snapshots, retain at most 96 samples in process memory, and are explicitly labeled `process-scoped`. No historical uptime is inferred.

This is local evidence, not a staging/public deployment or public browser verification claim.
