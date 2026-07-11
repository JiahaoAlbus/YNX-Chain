# Next Action

Current single action: deploy the bounded Explorer index-lag verifier fix, then close the two remaining external public-proof blockers without overstating validator consensus.

Why this action:

- Four validator-role nodes are running the deployed YNX Testnet release with chain ID `6423`, native `YNXT`, strict SSH, current build identity, and fresh peer height observations.
- Public RPC, EVM, Faucet, Indexer, Explorer, AI, Pay, Trust, and Resource endpoints are live.
- Public Chain Law and resource/pay/AI-action mutable flows now pass. Immediate Explorer transaction lookup races index polling, the OpenAI provider account returns `429 insufficient_quota`, and Web4 still serves the legacy chain Hub.
- The nodes still produce independent local block histories. Fresh peer height observations prove connectivity, not consensus, block replication, or state convergence.

Required engineering and verification work:

- Commit and deploy the bounded Explorer lookup polling fix, then rerun current-HEAD verification.
- Restore provider quota or supply another real compatible provider credential, then rerun authenticated AI SSE proof.
- Implement and deploy a YNX `6423` Web4 service before moving `web4.ynxweb4.com`; do not relabel the legacy Hub or proxy chain health as Web4 proof.
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
