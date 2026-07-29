# YNX Search Current State

Updated: 2026-07-29T02:49:16Z

## Identity

- Product: `23 — YNX Search`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/23-search`
- Branch: `codex/final-search`
- Repository: `JiahaoAlbus/YNX-Chain`
- Phase: `FREEZE`
- Goal status: `Active`

## Git checkpoint

- Protected runtime Local SHA: `88ee867322ec11a243a483c04bab99676cc3416e`
- Protected runtime Remote SHA: `88ee867322ec11a243a483c04bab99676cc3416e`
- Observed `origin/main` SHA: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Ahead / behind at protected runtime checkpoint: `0 / 0`
- Dirty state at protected runtime checkpoint: `clean`
- Record scope: evidence synchronization may advance repository HEAD without
  changing the protected runtime source attribution.

## Verification

- `cd apps/search && npm run check`: pass, 31/31 tests plus smoke, Search-local
  security scan, deterministic feed verification and recovery drill.
- `cd apps/search && npm run test:e2e`: pass, 6/6 Chromium scenarios.
- `cd apps/search && npm audit --omit=dev --audit-level=high`: pass, zero
  vulnerabilities.
- `cd apps/search && YNX_BUILD_COMMIT=88ee867322ec11a243a483c04bab99676cc3416e npm run capacity`:
  pass, 80/80 loopback requests at concurrency 8; p50 8.82 ms, p95 22.57 ms,
  p99 34.03 ms and 713.98 requests/second. Local single-process evidence only.
- Shared permissions tests previously passed 15/15.
- Repository-wide Go failures remain outside Search ownership; no Go file changed
  in the protected runtime slice.

## GitHub and release

- Branch Pull Request: none observed.
- Branch GitHub Actions runs: none observed.
- Current-source CI: not proven.
- Historical prerelease: `YNX Browser & Search 0.2.0 Testnet Preview 1`; not bound
  to the protected runtime source.
- Current release publication, artifact, SBOM and provenance for this source: not
  proven.

## Deployment

- Historical staging URL:
  `https://search-staging.43.153.202.237.sslip.io`
- Historical deployed SHA:
  `d68b5d89c0d2e92744bf634c55b776397ec8f896`
- Current protected runtime source deployed to staging: `false`
- Approved staging corpus: intentionally empty.
- Public deployment: `false`
- Canonical product route: `https://ynxweb4.com/search`
- Canonical route deployed and verified: `false`
- `huangjeo.com` is not a YNX product domain and is not used as a Search
  canonical, support, status or handoff address.

## Completed locally

- Source Registry v4 and fail-closed migration.
- Explicit public data-class and source-use rights enforcement.
- Outbound URL, robots and DNS-rebinding controls.
- Explainable lexical ranking and canonical YNX entities.
- Citation-bound AI preparation with server-owned retrieval rights.
- Persistent remedy and Wallet callback challenge state.
- Deterministic public Search feeds and manifest.
- Exact-byte backup, separate-path restore and deterministic public reindex.
- Request, Trace and Error correlation.
- Bounded structured logs and protected Prometheus metrics.
- Reproducible local capacity evidence.

## Remaining

- Provider-neutral external Search adapter and provider-backed verification.
- Retention expiry and export/delete operational verification.
- Central Wallet, AI, Trust, Browser, Data Fabric, Monitor, Website, Integration
  and Security acceptance.
- Current-source staging deployment, restart, migration, metrics, capacity,
  backup, restore and rollback evidence.
- PR, CI, immutable artifact, SBOM, provenance, release and public Website route.

## Current risks

- Runtime source and historical staging SHA differ.
- No branch CI or current-source release evidence exists.
- Process-local metrics reset on restart and have no central durable scrape.
- External provider behavior and costs are not measured.
- Public feed files are local artifacts only until Website owner hosts and verifies
  their hashes.

## Evidence

- `product-release.json`
- `public-product-metadata.json`
- `release/integration/search-contract.json`
- `apps/search/evidence/EVIDENCE_INDEX.md`
- `apps/search/evidence/capacity/local-loopback-88ee8673.json`
- `apps/search/OBSERVABILITY.md`
- `apps/search/SLO_CAPACITY_PLAN.md`
- `.ai-bridge/full-goal-coverage.json`
