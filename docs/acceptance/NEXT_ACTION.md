# Next Action

Current single action: map validator consensus public keys and generate a four-validator local CometBFT network while preserving the remotely verified authoritative replication path as a rollback boundary.

Intervening Explorer UI request is closed for this priority window: the RPC/indexer-backed Explorer now has a denser Apple-inspired network console with live height/TPS/block-time/index-lag metrics, live block and transaction feeds, transaction filtering, structured search, a detail drawer with copy actions, validator/resource views, explicit stream freshness, ten-second fallback, and a no-store HTML shell. Unit, full Go, project, smoke, desktop/mobile, SSE growth, filtering, detail interaction, overflow, console, and public endpoint checks pass. Scoped Explorer release `6cd65238c77b` is live and rollback-backed. Paginated history, contract/token analytics, charts, and richer account activity remain future real-indexer work; they are not claimed complete. Work now resumes on the consensus action below.

Why this action:

- Four validator-role nodes are running the deployed YNX Testnet release with chain ID `6423`, native `YNXT`, strict SSH, current build identity, and fresh peer height observations.
- Public RPC, EVM, Faucet, Indexer, Explorer, AI, Pay, Trust, and Resource endpoints are live.
- Public Chain Law and resource/pay/AI-action mutable flows now pass. Immediate Explorer transaction lookup races index polling, the OpenAI provider account returns `429 insufficient_quota`, and Web4 still serves the legacy chain Hub.
- The four deployed nodes now share a remotely verified authoritative history, but one producer remains a single authority. The final multi-validator L1 objective requires validator voting, quorum commits, Byzantine fault handling, and deterministic application-state execution.

Required engineering and verification work:

- Completed first slice: define and verify the deterministic consensus/application migration boundary against existing persisted YNXT state with `make consensus-migration-check`.
- Completed adapter slice: pin CometBFT `v0.38.23`, connect the YNXT migration state to ABCI 2.0, and verify direct plus Unix socket lifecycle behavior with `make consensus-abci-check`.
- Completed signed execution slice at `b9df248`: add EVM-compatible secp256k1 native accounts, canonical signed transfer envelopes, chain replay/tamper and nonce enforcement, deterministic transfer/fee/bandwidth/traceable-lot execution, proposal sequencing, transfer events, deterministic AppHash, atomic mode-`0600` state persistence, restart recovery, state-tamper rejection, and failed-commit no-advance behavior. `go test -race ./internal/consensus`, `make consensus-abci-check`, and `make consensus-signed-transfer-check` pass, including a real Unix socket signed transfer.
- Next implementation slice: map each configured validator identity to a CometBFT consensus public key, generate four ephemeral local homes and separate ABCI state paths outside Git, connect peers/genesis/proxy applications, and prove quorum commits plus one-validator stop/restart.
- Add a migration and rollback contract that preserves current YNXT state and the deployed public API during staged validator rollout.

Files to touch:

- Consensus validator-key mapping, local CometBFT harness, genesis/home generation, verifier, and acceptance-state files
- Existing ignored deployment env and generated `tmp/verify-testnet/` evidence
- No committed secret files

Validation commands:

- `go test ./...`
- `make consensus-migration-check`
- `make consensus-abci-check`
- `make consensus-signed-transfer-check`
- Add and run `make consensus-quorum-check`
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
- A local multi-validator BFT network commits the same blocks through quorum voting and survives one validator stop/restart.
- Every local validator migration identity is bound to the exact public key/address in the generated CometBFT genesis, with private key files remaining ephemeral, mode restricted, Git-ignored, and absent from logs.
- Existing YNXT application state has a deterministic migration/rollback path and current API tests remain green.
- Public proof remains false until every required chain, validator, release manifest, AI, Pay, Trust, Resource, Chain Law, explorer, faucet, indexer, and mutable-flow check passes.

Explicitly not doing:

- Do not place secrets in git.
- Do not reuse ephemeral local validator keys for remote testnet or owner custody.
- Do not expand bounded EVM opcodes, Counter samples, Hardhat artifacts, or IDE execution during this priority window.
- Do not claim mainnet, listing, issuer support, wallet default support, partnerships, consensus completion, or complete public proof before the corresponding evidence passes.
