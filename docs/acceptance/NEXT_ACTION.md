# Next Action

Current single action: obtain trusted out-of-band approval for the Singapore and Silicon Valley SSH host fingerprints, then pass the deployment gate for the current HEAD before any remote mutation.

Why this action:

- Faucet, Indexer, Explorer, AI, Pay, Trust, and Resource Market now have independent deployable service boundaries with local tests, smoke checks, deployment wiring, monitoring, operations, and fail-closed public-proof requirements.
- Public endpoints still prove the legacy `ynx_9102-1` / EVM `0x238e` network, while the target is `ynx_6423-1` / EVM `6423` (`0x1917`) with native `YNXT`.
- Singapore and Silicon Valley strict SSH checks report host-key mismatches. Those fingerprints require independent cloud-console/provider confirmation; repository code and network scans cannot create trusted approval.

Required operator evidence:

- Run `make host-key-audit`, `make host-key-approval-request`, `make host-key-approval-packet`, and `make host-key-approval-status` to refresh non-mutating evidence.
- Verify every presented Singapore and Silicon Valley fingerprint through a trusted out-of-band source.
- Record only verified fingerprints plus the current `hostKeyAuditSha256`, approver, verification channel, and evidence in ignored `.host-key-approvals.json`.
- Run `make host-key-approval-check` and review `make host-key-approved-repair-dry-run` before `make host-key-approved-repair`.
- Supply real deployment env values and service secrets outside git, including AI, Pay, Trust, and Resource client/upstream keys.
- Refresh current-HEAD `make verify-testnet`, `make remote-smoke-test`, `make remote-blocker-report`, and require `make deploy-readiness-gate` to pass before `make deploy-testnet`.

Files to touch:

- Ignored `.host-key-approvals.json`, only after trusted out-of-band verification
- Ignored real deployment env/secret-store values
- Generated `tmp/host-key-audit/` and `tmp/verify-testnet/` evidence
- No tracked implementation file unless verification exposes a concrete defect

Validation commands:

- `make host-key-approval-check`
- `make host-key-approved-repair-dry-run`
- `make verify-testnet`
- `make remote-smoke-test`
- `make remote-blocker-report`
- `make deploy-readiness-gate`
- `make deploy-testnet`
- `make public-proof`

Completion standard:

- Strict SSH succeeds for all four nodes with independently approved host keys.
- Remote evidence is fresh, current-HEAD/release-bound, and status `passed`.
- The deploy gate has no blocker.
- The new four-validator YNX Testnet and independent services are deployed and verified through non-local HTTPS endpoints.
- Public proof remains false until every required chain, validator, release manifest, AI, Pay, Trust, Resource, Chain Law, explorer, faucet, indexer, and mutable-flow check passes.

Explicitly not doing:

- Do not fabricate host-key approval or place secrets in git.
- Do not mutate remote hosts while the deployment gate is blocked.
- Do not expand bounded EVM opcodes, Counter samples, Hardhat artifacts, or IDE execution during this priority window.
- Do not claim mainnet, listing, issuer support, wallet default support, partnerships, remote deployment, or public proof.
