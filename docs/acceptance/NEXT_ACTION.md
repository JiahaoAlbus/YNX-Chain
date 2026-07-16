# Next Action

Highest-priority bounded delivery (2026-07-16):

Current single action: preserve deployed release `02f4ccd8770c`, configure one protected or node-local Prometheus scrape target for each authoritative follower, and prove a controlled follower alert becomes observable and clears after recovery. In parallel, diagnose intermittent direct public ingress without weakening timeouts and restore provider-backed AI only after the external account can return a real successful response.

Why this is next:

- The public chain still depends on one producer and three authenticated read-only followers while the approval-gated BFT transition remains intentionally inactive.
- Current source now exposes the real replication lifecycle, `catchingUp`, freshness, exact source/local height and hash, lag, attempts, successes, failures, timestamps, bounded error evidence, Prometheus telemetry, alerts, and Grafana panels.
- Current source now also seals the complete authoritative snapshot as v2, durably syncs replacement, permits one marker-free v1 migration, rejects later downgrade/corruption, and restores in-memory state when replication persistence fails.
- Local lifecycle, degraded recovery, persisted-state restart, exact convergence, race, smoke, and verification checks pass. Pinned Prometheus rule tests now prove that degraded, prolonged catch-up, lag, and consecutive-failure alerts fire after their configured hold time and clear after recovery.
- Authoritative snapshot-v2 runtime `02f4ccd8770c` is deployed on all four roles. Exact manifest/binary checks pass; every role has marker/version 2; all three followers passed fresh canonical convergence and read-only rejection; one Seoul restart proved lifecycle reset and authenticated recovery. The subsequent verifier race fix and bounded Explorer/AI waiting logic are local control-plane changes only and do not change the deployed chain runtime.
- Singapore-routed exact-release mutation smoke passed Faucet-to-Explorer, Pay, governance/Anti-Illegal, Trust appeal/transparency, Resource, and IDE. Provider-backed AI remains blocked by upstream HTTP `429`, and direct public ingress remains intermittent. These are not independent proof.

Files to touch:

- `internal/chain`, `cmd/ynx-chaind`
- `scripts/deploy`, `scripts/verify`
- API, operations, and acceptance documentation only after matching evidence exists

Required execution and proof:

- Preserve the four scoped predeploy backups and exact release/manifest/checksum evidence; do not rerun deployment while the current authoritative runtime remains healthy.
- Require each follower to continue reporting `status=synced`, `catchingUp=false`, `fresh=true`, exact source/local height and hash equality, and canonical agreement with the primary at that height.
- Configure and verify one protected or node-local Prometheus scrape target for each follower without exposing RPC or replication credentials.
- Use a controlled follower interruption only after protected scrape targets are active; prove the expected alert becomes observable and clears after recovery.
- Verify public block growth and transaction/receipt continuity after the restart.
- If ingress or SSH remains unsafe, record the external blocker and continue local chain/BFT engineering without claiming remote proof.

Validation commands:

- `go test ./...`
- `go test -race ./internal/chain ./cmd/ynx-chaind`
- `make validator-peer-readiness-check`
- `make monitoring-check`
- `make replication-alert-check`
- `make deploy-source-integrity-check`
- `make verify-testnet-check`
- `make replication-compression-check`
- `make smoke-test`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `GOMAXPROCS=2 make preflight`
- `make objective-state-check`

Completion standard:

- Exact release identity and scoped backup evidence exist on all four authoritative roles.
- Every role has persisted a valid snapshot v2 and downgrade marker without losing the pre-upgrade backup.
- All followers expose fresh exact source/local equality, and one follower repeats it after a controlled restart.
- All three follower scrape targets are protected, distinguishable, and produce one observed-and-cleared controlled interruption alert.
- Public chain growth and transaction/receipt continuity remain intact.
- No BFT cutover, mainnet launch, exchange listing, issuer support, wallet default support, partnership, or independent proof is inferred.

Explicitly not doing:

- Do not execute any BFT freeze, signer installation, dependency transition, ingress cutover, or public rollback phase without the required external approval.
- Do not expand bounded EVM/IDE except to preserve passing tests.
- Do not merge product branches out of dependency order.
- Do not modify or replace the long-term goal file.
