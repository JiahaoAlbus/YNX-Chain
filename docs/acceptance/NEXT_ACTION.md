# Next Action

Current single action: turn the classified blocker report into a safe remote recovery checklist and deployment gate.

Why this action:

- The blocker report now separates SSH closed, keyscan anomalies, legacy-chain responses, wrong chain id, endpoint timeouts, and 404s.
- The next deploy attempt needs a concrete pre-deploy gate that refuses mutation until SSH and public ingress evidence are both coherent.
- This moves toward real remote deployment without disabling host-key safety or presenting diagnostics as public proof.

Files to touch:

- `scripts/verify/remote-blocker-report.mjs`
- `scripts/verify/verify-testnet.sh` if the classified report exposes a missing pre-deploy gate
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/NEXT_ACTION.md`

Validation commands:

- `make host-key-audit` (expected to fail while remote SSH is closed)
- `YNX_REMOTE_TIMEOUT_MS=5000 YNX_REMOTE_BLOCK_GROWTH_DELAY_MS=1000 YNX_REMOTE_EVIDENCE_PATH=tmp/verify-testnet/remote-evidence.json make remote-smoke-test` (expected to fail while public endpoints time out)
- `make remote-blocker-report`
- `make preflight`

Completion standard:

- The next deploy gate clearly says which remote conditions must be fixed before `deploy-testnet` can mutate services.
- `tmp/verify-testnet/REMOTE_BLOCKERS.md` remains classified and still refuses to treat diagnostics as public proof.
- `PROJECT_STATE.md` records the latest blocker categories after the verification run.

Explicitly not doing in this action:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable SSH host-key checking.
- Do not delete or rewrite `~/.ssh/known_hosts`.
- Do not deploy without real `.env.deploy` and reachable verified SSH.
- Do not claim the goal is complete.
