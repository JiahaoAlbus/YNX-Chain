# Next Action

Highest-priority bounded delivery (2026-07-16):

Current single action: preserve deployed release `02f4ccd8770c` and protected Prometheus, diagnose the intermittent direct public ingress failures without weakening timeouts, and prove repeated direct-route chain/API continuity. Restore provider-backed AI only after the external account can return a real successful response.

Why this is next:

- The public chain still depends on one producer and three authenticated read-only followers while the approval-gated BFT transition remains intentionally inactive.
- Current source now exposes the real replication lifecycle, `catchingUp`, freshness, exact source/local height and hash, lag, attempts, successes, failures, timestamps, bounded error evidence, Prometheus telemetry, alerts, and Grafana panels.
- Current source now also seals the complete authoritative snapshot as v2, durably syncs replacement, permits one marker-free v1 migration, rejects later downgrade/corruption, and restores in-memory state when replication persistence fails.
- Local lifecycle, degraded recovery, persisted-state restart, exact convergence, race, smoke, and verification checks pass. Prometheus 3.11.2 is now deployed on the primary's WireGuard address with four distinct targets; a controlled Seoul outage made the expected metrics-down alert pending, firing, and cleared after recovery.
- Authoritative snapshot-v2 runtime `02f4ccd8770c` is deployed on all four roles. Exact manifest/binary checks pass; every role has marker/version 2; all three followers passed fresh canonical convergence and read-only rejection; one Seoul restart proved lifecycle reset and authenticated recovery. The subsequent verifier race fix and bounded Explorer/AI waiting logic are local control-plane changes only and do not change the deployed chain runtime.
- Post-drill convergence passed for all followers, including restarted Seoul at height `200947`, and public RPC grew from `200969` to `200971`. The same verifier still observed direct REST, Faucet, Explorer, AI, and Pay fetch failures. Singapore-routed exact-release mutation smoke passed earlier, but it does not prove the direct route. Provider-backed AI remains blocked by upstream HTTP `429`. These are not independent proof.

Files to touch:

- ingress and reverse-proxy configuration, health checks, and bounded diagnostics
- `scripts/deploy`, `scripts/verify`
- API, operations, and acceptance documentation only after matching evidence exists

Required execution and proof:

- Preserve the four scoped predeploy backups and exact release/manifest/checksum evidence; do not rerun deployment while the current authoritative runtime remains healthy.
- Require each follower to continue reporting `status=synced`, `catchingUp=false`, `fresh=true`, exact source/local height and hash equality, and canonical agreement with the primary at that height.
- Preserve the protected four-target Prometheus service and require all targets to remain `up=1` during ingress work.
- Correlate direct-route failures with DNS, TLS, ingress/reverse-proxy, and backend health evidence; do not hide failures with larger timeouts or retries that exceed existing bounded policy.
- Prove repeated direct-route exact-release reads, block growth, and transaction/receipt continuity after the restart. Operator-routed Singapore evidence remains a diagnostic fallback, not direct or independent proof.
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
- All three follower scrape targets remain protected and distinguishable after the completed observed-and-cleared interruption drill.
- Multiple bounded direct-ingress cycles pass exact-release reads, public chain growth, and transaction/receipt continuity without zero-status fetch failures.
- No BFT cutover, mainnet launch, exchange listing, issuer support, wallet default support, partnership, or independent proof is inferred.

Explicitly not doing:

- Do not execute any BFT freeze, signer installation, dependency transition, ingress cutover, or public rollback phase without the required external approval.
- Do not expand bounded EVM/IDE except to preserve passing tests.
- Do not merge product branches out of dependency order.
- Do not modify or replace the long-term goal file.
