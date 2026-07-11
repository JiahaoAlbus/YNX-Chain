# Next Action

Current single action: productionize the remote BFT deployment contract around the locally proven four-validator CometBFT quorum, without changing the current public authoritative network until a parallel rehearsal and rollback gate pass.

Why this action:

- Commit `b1275c4` binds four active YNX validator identities to exact CometBFT ed25519 keys/addresses and generates four isolated homes, a byte-identical genesis, separate ABCI state, and full peer wiring.
- `make consensus-quorum-check` proves common quorum commits, participation by all four genesis validators, a real signed YNXT RPC broadcast, deterministic balances/nonces, continued progress with one validator offline, and stopped-node restart/catch-up.
- The generated validator and signer keys are disposable local fixtures only. They are mode restricted, absent from Git/logs/manifests, and must never be reused for remote testnet or custody.
- The public network still uses remotely verified single-producer authoritative replication. It is a rollback boundary, not BFT consensus.

Required implementation work:

- Define a public-key-only production validator manifest that binds each approved YNX validator identity to its CometBFT consensus public key/address. Reject missing, duplicate, inactive, malformed, or mismatched entries. Never ingest, copy, print, or commit private keys.
- Add production CometBFT configuration and systemd units for four independent validator/ABCI processes, persistent data paths, private P2P/RPC/ABCI listeners, firewall expectations, restart policy, logs, and health checks.
- Add a staged migration package that exports and verifies the authoritative YNXT state anchor, builds one common production genesis, installs the candidate on parallel non-public ports, and leaves current public services untouched.
- Add backup and rollback commands that restore the authoritative services and state if genesis, AppHash, validator set, quorum, catch-up, signed transaction, or ingress checks fail.
- Add a dry-run verifier for package checksums, service/env identity, no-secret output, common genesis/AppHash, four validator addresses, peer coverage, quorum threshold, stop/restart recovery, and rollback readiness.
- Update API/deployment documentation only after the real production package and checks exist.

Files to touch:

- Consensus production manifest/config validation, deployment and systemd packaging, migration/rollback scripts, local dry-run verifier, and the four acceptance-state files
- Ignored operator input/evidence paths only for public keys and generated non-secret reports
- No private key, mnemonic, PEM content, real `.env`, or generated validator home in Git

Validation commands:

- `go test ./...`
- `make consensus-migration-check`
- `make consensus-abci-check`
- `make consensus-signed-transfer-check`
- `make consensus-quorum-check`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `ENV_FILE=.env.deploy make env-check`
- `make preflight`
- `make objective-state-check`
- `ENV_FILE=.env.deploy make deploy-dry-run`

Completion standard:

- The owner performs the validator key ceremony outside Git and chat, retains every private key, and supplies only verified public keys/addresses to the deployment manifest.
- All four server identities, SSH host keys, private network listeners, firewall rules, persistent paths, backups, and rollback commands are independently verified.
- A parallel candidate network reproduces the approved migration AppHash, commits with four approved validators, survives one validator stop/restart, and executes an owner-approved signed test transaction.
- Public ingress changes occur only after the candidate and rollback gates pass. Fresh remote evidence must then prove block growth, validator signatures, common hashes, catch-up, service build identity, and all required public APIs.

Explicitly not doing:

- Do not reuse ephemeral lab keys or expose owner/validator secrets.
- Do not label the current remote producer/follower deployment as BFT consensus.
- Do not expand bounded EVM opcodes, Counter samples, Hardhat artifacts, IDE execution, or Explorer feature breadth during this priority window.
- Do not claim remote BFT, mainnet launch, exchange listing, stablecoin issuer support, wallet default support, partnerships, or complete public proof before corresponding live evidence exists.
