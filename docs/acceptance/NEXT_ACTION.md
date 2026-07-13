# Next Action

Current single action: publish and remotely verify the completed dual-address implementation through the ordinary authoritative deployment path.

Why this action:

- Go, JavaScript, Python, REST, signed CLI, account-key output, and Explorer support now pass local shared-vector and smoke tests.
- The public network still runs authoritative release `c9324fbfc464`, so it would be false to claim public `ynx1...` support now.
- An ordinary authoritative deployment can ship this bounded compatibility feature without performing the externally gated BFT mutation transaction.

Required behavior:

- Commit and push only after all local gates remain green.
- Build and deploy an exact checksummed release through existing scoped backup, rollback, strict SSH, health, convergence, and release-identity safeguards.
- Do not start or route the CometBFT candidate and do not execute freeze, pause, final snapshot, signer install, or ingress mutation phases.
- Verify public chain identity and growth remain correct after deployment.
- Create or identify a non-secret public test account, derive its `ynx1...` alias locally, and prove public REST and Explorer lookups resolve to the same canonical `0x...` account without exposing private material.
- Preserve MetaMask/EVM behavior on `0x...` and report any failed public alias check honestly.

Files to touch:

- Current chain source and acceptance files only if verification finds a real issue.
- Existing deployment, rollback, release-manifest, and remote verification scripts.
- Non-secret evidence under the existing ignored evidence paths; never commit env, PEM, signer keys, tokens, or raw private material.

Validation commands:

- `go test ./...`
- `make address-codec-check`
- `make sdk-check`
- `make explorer-check`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make objective-state-check`
- existing deploy dry-run/readiness and post-deploy verification commands required by the deployment tooling

Completion standard:

- The exact pushed commit is the exact deployed release on all authoritative roles.
- Existing chain ID, native symbol, height growth, convergence, service health, backups, and rollback evidence remain valid.
- Public REST and Explorer accept a valid `ynx1...` alias and return the same canonical account as its `0x...` form.
- Public EVM JSON-RPC still reports `0x1917` and accepts canonical EVM addresses.
- If any remote proof fails, retain the previous release or roll back and record the feature as local-only.

Explicitly not doing:

- No new address features, EVM opcodes, Counter/Hardhat expansion, arbitrary IDE execution, or unrelated Explorer redesign until deployment proof closes.
- No signer upload, freeze, pause, ingress switch, or BFT cutover without independent custody approval.
- Do not modify or replace the long-term goal file.
