# Next Action

Current single action: implement the production phase driver for the locally verified approval-gated public BFT cutover transaction, then run a current-topology remote rehearsal without switching public ingress. Do not execute public routing changes until custody inputs, phase evidence, rollback rehearsal, and explicit live approval pass.

Current live blocker (read-only check at 2026-07-12 19:11 CST): primary and Singapore were at height `42260`, Silicon Valley at `41743`, and Seoul at `41161`. Silicon Valley and Seoul showed repeated authoritative replication timeouts. Restore follower connectivity/convergence before any cutover rehearsal; no remote mutation was made.

Why this action:

- All fifteen BFT Gateway compatibility capabilities now have local and private four-validator candidate proof, including bounded IDE contract state, receipts, real logs, direct Comet matching, four-application equality, cleanup, and rollback.
- The candidate is intentionally absent and public endpoints still run authoritative producer/follower replication.
- `publicCutoverReady=false` is correct: capability completeness alone does not solve final snapshot timing, mutation freeze, service/ingress transition, custody, continuity, or automatic rollback.
- The next real engineering gap is a bounded, reversible transition transaction, not more opcode, contract, feature, Explorer UI, or marketing work.

Required work:

- Keep the implemented Gateway runtime authorization default false; preserve its capability, release, commit, and UTC build identity gates.
- Map every implemented transaction phase to reviewed Tencent operations using the current verified host/key/role inventory. The production driver must be idempotent and write evidence for every remote action.
- Extend the implemented transaction engine with a production driver that prebuilds binaries and verifies current HEAD/release identity, host keys, overlay, production custody paths, disk, backups, public endpoint identity, and candidate absence before any mutation.
- Deploy and remotely verify the implemented shared marker-based mutation freeze; preserve supported read-only EVM/HTTP health, reject writes, and record freeze/unfreeze evidence.
- Pause authoritative block production only after the freeze gate passes, export a final fresh migration, bind the approved validator manifest, deploy the candidate, and require four-signer/common-hash/four-application state evidence.
- Start persistent BFT Gateway and dependent BFT-mode services on loopback, rebuild/resume Indexer from the retained candidate boundary, and verify Explorer/API continuity before changing ingress.
- Atomically switch ingress with a checksummed backup, then require public chain identity, no height regression, height growth, four validators, EVM receipt/log behavior, Faucet/AI/Pay/Trust/Resource/IDE checks, Indexer lag, Explorer SSE, release identity, and cross-region health.
- Define automatic rollback thresholds for any service failure, identity mismatch, height stall/regression, signer loss, index lag, or evidence mismatch. Rollback must restore ingress, authoritative producer/followers, mutation routes, and public health from the backup point.
- Keep the non-mutating plan and clean temporary-repository self-test proving ordering, cleanup, and failure injection without touching public services.

Files to touch:

- production driver and service templates under `scripts/deploy`, `scripts/ops`, and `scripts/verify` for real freeze, final snapshot, continuity gates, ingress, and remote automatic rollback.
- service/env examples and operations/API docs only after real flags and handlers exist.
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`, `PROJECT_STATE.md`, and `NEXT_ACTION.md` after verified local/dry-run evidence.
- Do not modify or replace the long-term goal file.

Validation commands:

- `go test ./...`
- `make test`
- `make bft-gateway-check`
- `make bft-ide-contract-check`
- `make bft-evm-receipt-check`
- `make consensus-production-package-check`
- `make consensus-public-cutover-check`
- `make public-bft-cutover-transaction-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- Default and ordinary candidate Gateway health remain `publicCutoverReady=false` even with fifteen implemented capabilities.
- Explicit authorization is necessary but not sufficient; stale/non-current release, missing custody, incomplete candidate evidence, absent freeze, failed dependencies, or failed continuity must block readiness and cutover.
- Dry-run and injected failures restore the exact pre-cutover service/ingress state and leave authoritative public health intact.
- A public cutover is not complete until live public proof passes after the switch and rollback remains available; do not infer this from private candidate evidence.

Explicitly not doing:

- No new EVM opcodes, Counter behavior, Hardhat artifacts, sample contracts, arbitrary IDE execution, or unrelated Explorer/UI expansion.
- No public routing switch before the explicit gate and production custody/rollback evidence pass.
- No mainnet, exchange-listing, stablecoin-issuer, wallet-default, partnership, public BFT, or goal-completion claim before real public proof.
