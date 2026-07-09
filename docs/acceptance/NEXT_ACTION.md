# Next Action

Current single action: add release artifact manifest and checksum/provenance verification for the `ynx_6423-1` deploy package. Remote deployment remains blocked, so the next useful chain-construction work is to bind the running `ynx-chaind` release identity to a concrete build artifact checksum, not only to a git commit string.

Why this action:

- Validator metadata, peer readiness, peer discovery, peer sync records, automatic peer polling, `/node/identity`, `/status.nodeIdentity`, role-specific deploy env files, startup guards, deploy-time `ynx-chaind --check-config`, and release/build identity now exist locally.
- `deploy-testnet` injects `build.commit`, `build.release`, and `build.buildTime` into `ynx-chaind`, and local/remote verifiers require that identity.
- A future public proof still needs stronger artifact provenance: the release bundle should record checksums for the built binaries and the verifier should be able to compare the deployed artifact metadata against the running node identity.
- Remote public deployment is still blocked by SSH/host-key and public endpoint evidence, so local code should keep improving proof quality without mutating remote hosts.

Files to touch:

- `scripts/deploy`
- `scripts/verify`
- `scripts/package`
- `docs/operations`
- `docs/api/API_REFERENCE.md`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`

Validation commands:

- `go test ./...`
- `make test`
- `make smoke-test`
- `make validator-peer-readiness-check`
- `make deploy-dry-run`
- `make verify-testnet-check`
- `make env-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Deploy build writes a non-secret release manifest with git commit, release name, build time, binary paths, and SHA-256 checksums.
- `make deploy-dry-run` proves the manifest exists, references `ynx-chaind`, and matches the generated binary checksum.
- Remote verifier has a safe path to check manifest metadata without printing secrets.
- Public proof expectations document how live `/status.build` and `/node/identity.build` should map to the release manifest.
- Remote deployed/public proof remains `no` until real public endpoints pass.

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, missing release identity, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
