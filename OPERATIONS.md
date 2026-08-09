# Operations

This file is the Chain Core operations index. The detailed runbook is `docs/operations/OPERATIONS_RUNBOOK.md`; deployment guidance is `docs/deployment/TESTNET_DEPLOYMENT_GUIDE.md`. Commands mutate remote state only when their own approvals and operator inputs are present.

## Read-only inspection

- `make status` reads configured node and service state.
- `make verify-testnet` verifies the recovered topology and release evidence.
- `make host-key-audit` validates pinned SSH host identities without repairing them.
- `make authoritative-monitoring-check` validates monitoring configuration locally.
- `make public-ingress-diagnostic` classifies the current vantage before public proof is accepted.

## Local release gates

- `go test ./...`, `make static-check`, `make no-placeholder-check`, and `make secret-scan` are the baseline source gates.
- `make streambft-candidate-check` is a shadow-candidate gate and is expected to remain ineligible when required evidence is absent.
- `make asset-primitives-check`, `make account-abstraction-check`, `make solvency-check`, `make liquid-staking-candidate-check`, `make safety-module-candidate-check`, and `make yusd-sandbox-check` validate their exact local boundaries only.
- `make consensus-production-package-check` and `make release-manifest-check` validate package structure; they do not install or deploy it.

## Backup, restore and rollback

- `make backup` invokes the existing node backup workflow with configured operator inputs.
- `make rollback` invokes the recovered release rollback workflow. It must target a known compatible binary/state pair.
- The public BFT driver performs scoped transaction-bound backup, checksum and archive validation before mutation freeze or cutover.
- Restore acceptance requires a separate target, verified archive hash, matching release/state schema, successful start, identical expected AppHash/state records, and recorded RTO/RPO. A backup archive alone is not a restore drill.

## Public BFT transaction

The authoritative sequence is preflight, scoped backup, freeze mutations, pause the authoritative writer while retaining reads, export the final snapshot, deploy and verify the candidate, start dependencies, verify continuity, switch ingress, verify public behavior, and close the transaction. Failure triggers rollback in reverse order: ingress, dependencies, candidate, authoritative writer, mutation freeze, then recovery verification.

Use `make public-bft-production-rehearsal` only with the exact approval packet required by the script. Use the production transaction only after custody, signer, backup, migration anchor, public ingress, and rollback evidence are complete. Never bypass a failed phase manually while representing the transaction as successful.

## Incident priorities

1. Preserve user exits and read access where safe.
2. Stop new mutations through the transaction-bound freeze mechanism when integrity is uncertain.
3. Preserve logs, AppHash, block/validator evidence, service health, release hashes, and the transaction journal.
4. Roll back only to the verified compatible state/binary pair; never reset or discard state to make health checks pass.
5. Publish an incident state that distinguishes confirmed facts, unknowns, affected scope, exit availability, and next update time.

## Current operational truth

The authoritative public runtime is older than this branch and uses one producer with three read-only followers. Current-source AA, solvency, staking, Strategy Vault, and Safety Module candidate changes are not deployed. Git push is also incomplete because repeated HTTPS attempts produced no response and were safely interrupted. Public cutover, four-validator evidence, current-source backup/restore, eligible-vantage smoke, and remote SHA equality remain required.
