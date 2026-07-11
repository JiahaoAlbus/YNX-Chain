# Next Action

Current single action: deploy the current verification-contract fix, rerun current-HEAD remote verification, and close the remaining public mutable-flow evidence without overstating validator consensus.

Why this action:

- Four validator-role nodes are running the deployed YNX Testnet release with chain ID `6423`, native `YNXT`, strict SSH, current build identity, and fresh peer height observations.
- Public RPC, EVM, Faucet, Indexer, Explorer, AI, Pay, Trust, and Resource endpoints are live.
- The last remote run exposed two concrete contract defects fixed in the current worktree: missing `expectedValidatorCount` on `/validators` and missing Indexer `/ynx/overview`.
- The nodes still produce independent local block histories. Fresh peer height observations prove connectivity, not consensus, block replication, or state convergence.

Required engineering and verification work:

- Commit and deploy the `/validators` metadata and Indexer overview fixes with the existing ignored deployment env and approved host-key evidence.
- Run current-HEAD `make verify-testnet`; require public Chain Law request/review/reject, appeal, correction, transparency, AI, Pay, Trust, Resource, faucet, IDE, explorer, and indexer checks to execute rather than be skipped.
- Keep peer checks scoped to fresh reachability and height evidence. Implement a real consensus or deterministic block/state replication layer before claiming validator state convergence.

Files to touch:

- Current tracked API, Indexer, verifier, and acceptance-state files
- Existing ignored deployment env and generated `tmp/verify-testnet/` evidence
- No committed secret files

Validation commands:

- `go test ./...`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `ENV_FILE=.env.deploy make env-check`
- `make preflight`
- `make objective-state-check`
- `ENV_FILE=.env.deploy make deploy-dry-run`
- `ENV_FILE=.env.deploy make verify-testnet`
- `make public-proof`

Completion standard:

- Strict SSH continues to succeed for all four nodes with independently approved host keys.
- Remote evidence is fresh, current-HEAD/release-bound, and status `passed`.
- The four-node YNX Testnet and independent services are verified through non-local HTTPS endpoints, described honestly as validator-role nodes until consensus/state convergence exists.
- Public proof remains false until every required chain, validator, release manifest, AI, Pay, Trust, Resource, Chain Law, explorer, faucet, indexer, and mutable-flow check passes.

Explicitly not doing:

- Do not place secrets in git.
- Do not expand bounded EVM opcodes, Counter samples, Hardhat artifacts, or IDE execution during this priority window.
- Do not claim mainnet, listing, issuer support, wallet default support, partnerships, consensus completion, or complete public proof before the corresponding evidence passes.
