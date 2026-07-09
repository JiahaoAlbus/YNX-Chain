# Next Action

Current single action: add release/build identity evidence to the `ynx_6423-1` node runtime and remote verification path. Remote deployment remains blocked, so the next useful chain-construction work is to make each running node prove which source commit/release it is serving, not only which validator env it loaded.

Why this action:

- Validator metadata, peer readiness, peer discovery, peer sync records, automatic peer polling, `/node/identity`, `/status.nodeIdentity`, role-specific deploy env files, startup guards, and deploy-time `ynx-chaind --check-config` now exist and are locally verified.
- `deploy-testnet` now validates installed role env files with the chain binary before restarting, but a future remote proof still cannot tie a live public node response to a specific release commit or deploy artifact.
- Remote public deployment is still blocked by SSH/host-key and public endpoint evidence, so local code should keep improving proof quality without mutating remote hosts.
- Release/build identity is the next smallest runtime gap between safe deployment packaging and credible public proof.

Files to touch:

- `cmd/ynx-chaind`
- `internal/chain`
- `internal/api`
- `scripts/deploy`
- `scripts/verify`
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

- The built `ynx-chaind` binary receives a non-secret release identifier from the deploy build path, such as git commit, release name, or build time.
- `/status` and/or `/node/identity` exposes release/build identity without exposing secrets.
- `verify-testnet` and `remote-smoke-test` require live remote endpoints to expose expected release/build identity after deploy-readiness clears.
- `make deploy-dry-run` proves the release/build identity is injected into the deploy artifact and visible to the config/runtime check path.
- Local unit tests cover default/unknown release identity and explicitly injected release identity.
- Remote deployed/public proof remains `no` until real public endpoints pass.

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
