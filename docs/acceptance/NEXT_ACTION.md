# Next Action

Current single action: harden remote blocker diagnostics for the current remote failure mode.

Why this action:

- Real deployment is blocked by remote SSH connection closures and public endpoint timeouts.
- The next deploy attempt needs a report that clearly separates host-key mismatch from SSH daemon/network closure and public endpoint downtime.
- This moves the real remote deployment path forward without weakening host-key safety or pretending public proof exists.

Files to touch:

- `scripts/verify/remote-blocker-report.mjs`
- `scripts/ops/host-key-audit.sh` if raw host-key evidence needs clearer machine-readable output
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/NEXT_ACTION.md`

Validation commands:

- `make host-key-audit` (expected to fail while remote SSH is closed)
- `YNX_REMOTE_TIMEOUT_MS=5000 YNX_REMOTE_BLOCK_GROWTH_DELAY_MS=1000 YNX_REMOTE_EVIDENCE_PATH=tmp/verify-testnet/remote-evidence.json make remote-smoke-test` (expected to fail while public endpoints time out)
- `make remote-blocker-report`
- `make preflight`

Completion standard:

- `tmp/verify-testnet/REMOTE_BLOCKERS.md` explicitly names whether each node is blocked by host-key mismatch, SSH connection closed/unreachable, or missing evidence.
- Public endpoint failures are summarized as timeout/unreachable versus wrong legacy chain where evidence supports that distinction.
- The report still refuses to treat diagnostics as public proof.

Explicitly not doing in this action:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable SSH host-key checking.
- Do not delete or rewrite `~/.ssh/known_hosts`.
- Do not deploy without real `.env.deploy` and reachable verified SSH.
- Do not claim the goal is complete.
