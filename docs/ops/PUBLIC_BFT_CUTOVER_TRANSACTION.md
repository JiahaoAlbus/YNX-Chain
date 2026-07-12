# Public BFT Cutover Transaction

YNX Chain public BFT cutover is an approval-gated transaction. The transaction engine is implemented and locally failure-tested; a production driver and live approval are still required. Running the plan target does not change services or ingress.

## Safety gates

- `PUBLIC_BFT_CUTOVER_MODE` defaults to `plan`; only `execute` can invoke a driver.
- Execution requires `PUBLIC_BFT_CUTOVER_APPROVED=yes`, an executable driver, a clean `main` worktree, and a mode-`0600` approval file.
- Approval must be valid for no more than 24 hours and bind the exact 12-character commit and `ynx-bft-gateway-<commit>` release.
- Approval must explicitly set both `publicCutoverAuthorized` and `automaticRollbackRequired` to `true`.
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

## Commands

```bash
make public-bft-cutover-plan
make public-bft-cutover-transaction-check
make mutation-freeze-check
```

The second command uses a clean temporary Git repository and a local state driver. It verifies a successful transition and injects failures after ten mutating or post-mutation phases, requiring the exact authoritative baseline and a passed rollback journal each time.

Do not run execute mode until the production driver maps every phase to reviewed remote commands, custody inputs are available, the rollback rehearsal passes against the current public topology, and a live approval file is issued. Local self-test evidence is not public BFT proof.
