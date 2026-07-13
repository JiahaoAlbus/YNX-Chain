# Public BFT Cutover Transaction

YNX Chain public BFT cutover is an approval-gated transaction. The transaction engine is implemented and locally failure-tested. The production driver currently implements read-only preflight, scoped backup, mutation freeze/unfreeze, read-preserving authoritative pause/resume, final snapshot export, transaction-bound candidate deploy/verify/rollback, and recovery verification. Dependency transition, continuity, ingress, and public verification phases remain unimplemented. Running the plan target does not change services or ingress.

## Safety gates

- `PUBLIC_BFT_CUTOVER_MODE` defaults to `plan`; only `execute` can invoke a driver.
- Execution requires `PUBLIC_BFT_CUTOVER_APPROVED=yes`, an executable driver, a clean `main` worktree, and a mode-`0600` approval file.
- Approval must be valid for no more than 24 hours and bind the exact 12-character commit and `ynx-bft-gateway-<commit>` release.
- Approval must explicitly set both `publicCutoverAuthorized` and `automaticRollbackRequired` to `true`.
- Approval must bind `validatorManifestSha256` and a whole-second UTC `candidateGenesisTime`. Candidate generation requires that exact public-key-only manifest, a genesis time between the final snapshot timestamp and 30 minutes after it, and an approval that is still valid.
- Candidate deployment additionally requires `PUBLIC_BFT_PRODUCTION_CANDIDATE_APPROVED=yes`. Automatic candidate rollback consumes the transaction-local validated approval evidence and remains available after approval expiry so an in-flight failure cannot lose its rollback permission.
- Gateway readiness remains false unless its separate runtime authorization, complete capabilities, release identity, and UTC build identity all pass.
- Evidence is written with a restrictive umask to a transaction-specific directory.
- The authoritative API, BFT Gateway, Faucet, AI, Pay, Trust, and Resource services share `YNX_MUTATION_FREEZE_FILE`. An atomic marker enables the freeze without a restart. GET/HEAD/OPTIONS, supported read-only EVM JSON-RPC calls, and AI chat remain available; state-changing requests return HTTP `503` with retry headers.

## Driver contract

`PUBLIC_BFT_CUTOVER_DRIVER` receives one phase name per invocation. Production implementations must fail closed, write phase evidence under `PUBLIC_BFT_CUTOVER_TRANSACTION_DIR`, and make every rollback operation idempotent.

Forward order:

1. `preflight`
2. `backup`
3. `freeze_mutations`
4. `pause_authoritative`
5. `export_final_snapshot`
6. `deploy_candidate`
7. `verify_candidate`
8. `start_dependencies`
9. `verify_continuity`
10. `switch_ingress`
11. `verify_public`
12. `unfreeze_mutations`

After mutation freeze begins, any failure invokes all reverse operations: `rollback_ingress`, `rollback_dependencies`, `rollback_candidate`, `resume_authoritative`, `unfreeze_mutations`, and `verify_rollback`. Calling every operation is intentional because a driver can mutate state and fail before returning.

`deploy_candidate` generates its package only from `PUBLIC_BFT_CUTOVER_TRANSACTION_DIR/final-snapshot/migration.json`. It verifies the remote snapshot evidence, raw snapshot SHA-256, paused height/hash/state boundary, approved validator-manifest SHA-256, exact genesis time, generated package, and a mode-`0600` binding record before running four-role deployment. Candidate archives are mode `0600`, checksum-verified after upload, deleted through a remote exit trap, and absent after installation. Candidate binaries live under `/var/lib/ynx-chain/consensus-candidate/bin`; they do not overwrite `/usr/local/bin`, so candidate-state removal also removes the executable surface. `verify_candidate` requires four-role common consensus evidence. `rollback_candidate` stops and removes candidate services/state/releases, proves candidate ports are free, and keeps authoritative `ynx-chaind` active.

## Commands

```bash
make public-bft-cutover-plan
make public-bft-cutover-transaction-check
make public-bft-production-driver-check
make mutation-freeze-check
```

The transaction check uses a clean temporary Git repository and a local state driver. It verifies a successful transition and injects failures after ten mutating or post-mutation phases, requiring the exact authoritative baseline and a passed rollback journal each time. The production-driver check separately exercises candidate input/package tampering, missing approval, automatic-rollback consent, archive custody, repeated rollback, and all four remote command paths with `DEPLOY_DRY_RUN=1`.

Do not run execute mode until the production driver maps every phase to reviewed remote commands, custody inputs are available, the rollback rehearsal passes against the current public topology, and a live approval file is issued. Local self-test evidence is not public BFT proof.
