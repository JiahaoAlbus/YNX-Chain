# Next Action

Current single action: deploy and verify authenticated authoritative chain-state replication across all four validator-role nodes.

Why this action:

- Four validator-role nodes are running the deployed YNX Testnet release with chain ID `6423`, native `YNXT`, strict SSH, current build identity, and fresh peer height observations.
- Public RPC, EVM, Faucet, Indexer, Explorer, AI, Pay, Trust, and Resource endpoints are live.
- Public Chain Law and resource/pay/AI-action mutable flows now pass. Immediate Explorer transaction lookup races index polling, the OpenAI provider account returns `429 insufficient_quota`, and Web4 still serves the legacy chain Hub.
- The deployed nodes currently have independent local histories. The new local implementation disables follower production and replicates the producer's validated state, but only remote fixed-height/hash evidence can prove the deployment converged.

Required engineering and verification work:

- Deploy role-specific producer/follower env with the replication key kept outside git.
- Verify followers reject writes and can return the producer's exact block hash at one fixed height.
- Preserve the explicit boundary: this closes deterministic state convergence, not BFT consensus.

Files to touch:

- Chain replication, API, node startup, deployment, verifier, and acceptance-state files
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
- All three followers have block production disabled, report authoritative follower mode, and serve the same producer block hash at a fixed verified height.
- Restart persistence is covered locally and the remote convergence evidence is current-HEAD/release-bound.
- Public proof remains false until every required chain, validator, release manifest, AI, Pay, Trust, Resource, Chain Law, explorer, faucet, indexer, and mutable-flow check passes.

Explicitly not doing:

- Do not place secrets in git.
- Do not expand bounded EVM opcodes, Counter samples, Hardhat artifacts, or IDE execution during this priority window.
- Do not claim mainnet, listing, issuer support, wallet default support, partnerships, consensus completion, or complete public proof before the corresponding evidence passes.
