# Consensus

YNX Chain currently pins CometBFT `v0.38.23` and exposes the application through ABCI 2.0 in `cmd/ynx-abci`.

`ynx-chaind --export-consensus-state <path>` creates the deterministic migration anchor. Start the ABCI application with:

```bash
ynx-abci -migration-state <migration.json> -state <abci-state.json>
```

The native transaction envelope is canonical JSON signed with secp256k1 ECDSA. Its address is the lowercase EVM-compatible `0x` address derived from `keccak256(uncompressed_public_key[1:])`. Signing is domain-separated by `YNX_NATIVE_TX_V1` and binds version, numeric chain ID, transfer type, sender, recipient, amount, fixed fee, next nonce, and compressed public key. Private keys are never stored by the ABCI application.

`CheckTx`, `PrepareProposal`, `ProcessProposal`, and `FinalizeBlock` verify signatures and apply transfers sequentially. Execution preserves total YNXT supply, increments nonce and bandwidth usage, moves traceable lots in sorted order, and assigns the current fixed fee to the first active validator in the sorted migration set. The committed account state and AppHash are atomically stored with mode `0600`; a failed disk commit does not advance in-memory height.

Run `make consensus-migration-check`, `make consensus-abci-check`, and `make consensus-signed-transfer-check` for local evidence.

`make consensus-quorum-check` creates a new mode-restricted temporary network with four independent CometBFT homes, ed25519 validator keys, node keys, ABCI processes, persistent peers, byte-identical genesis, and separate durable application state. It verifies the YNX validator-to-consensus-key binding, four-validator set, cross-height signer participation, fixed-height block hash convergence, a secp256k1-signed YNXT transfer through CometBFT RPC, continued commits after one validator and its ABCI process stop, and the stopped validator's restart/catch-up. The official CometBFT CLI is pinned as a Go tool dependency.

The lab command refuses to generate keys without `-ephemeral`, refuses an existing output directory, and marks generated material local-only. Validator and node private key files are mode `0600`, excluded from the public manifest, removed after the check, and must never be reused remotely.

This is local quorum proof, not remote BFT deployment. Owner-controlled remote validator key ceremony, parallel remote staging, public ingress cutover, backup/rollback drills, and remote fault evidence remain incomplete.

## Production candidate package

Production staging uses a separate public-key-only contract. The operator supplies a JSON document conforming to `production-validator-manifest.schema.json` with exactly the approved `primary`, `singapore`, `silicon-valley`, and `seoul` identities, RFC1918 P2P addresses, CometBFT node IDs, ed25519 public keys, and derived consensus addresses. The generator rejects public/loopback P2P addresses, wrong role bindings, inactive or missing validators, duplicate roles/endpoints/keys, malformed keys, and address/public-key mismatches.

```bash
go run ./cmd/ynx-consensus-package \
  -migration-state <exported-migration.json> \
  -validator-manifest <public-validator-manifest.json> \
  -genesis-time <approved-UTC-RFC3339-time> \
  -output <new-package-dir>

go run ./cmd/ynx-consensus-package -verify-package <package-dir>
```

The generated package contains a bound migration anchor, common genesis, per-role CometBFT configuration, hardened candidate-only systemd units, install/health/backup/rollback scripts, and SHA-256 coverage for every packaged file. It contains no validator or node private keys. Candidate RPC, ABCI, and metrics listen on loopback; P2P uses the approved private address; the data root is `/var/lib/ynx-chain/consensus-candidate`; and the services are named `ynx-consensus-*-candidate` so they do not replace `ynx-chaind`.

Each server owner generates and retains its private validator and node keys outside Git and chat. Before installation, `ynx-consensus-keycheck` derives their public identities locally and compares them to the approved role manifest while rejecting group/world-readable files. It never prints private material.

`make consensus-production-package-check` generates a package from disposable lab keys, verifies package hashes and key matching, rejects unsafe inputs and tampering, builds all three Linux candidate binaries, and runs the strict-SSH four-role deployment path in dry-run mode. A real candidate deployment additionally requires the deploy-readiness gate and `CONSENSUS_CANDIDATE_APPROVED=yes`. This does not authorize public cutover and does not prove remote BFT until live quorum evidence passes.

After all four remote candidate services are running, `CONSENSUS_CANDIDATE_PACKAGE=<dir> ENV_FILE=.env.deploy make verify-consensus-candidate` gathers loopback CometBFT evidence over strict SSH. It requires the approved chain and local validator identities, one common height/hash, the exact four-address validator set, at least three approved precommit signatures, and all three approved peers on every node. The machine-readable result always records `publicCutoverAuthorized: false`; fault/restart and signed owner-transaction drills remain separate required approvals before cutover.

`CONSENSUS_CANDIDATE_FAULT_DRILL_APPROVED=yes CONSENSUS_CANDIDATE_PACKAGE=<dir> ENV_FILE=.env.deploy make consensus-candidate-fault-drill` is the separately gated remote stop/restart drill. It stops only the selected candidate CometBFT and ABCI services, requires all other validators to advance, restarts the stopped role, waits for catch-up, reruns the common-block verifier, and checks that authoritative `ynx-chaind` remains active throughout. Its cleanup trap restarts the selected candidate after intermediate failures.

`CONSENSUS_CANDIDATE_SIGNED_TX_APPROVED=yes ... make consensus-candidate-signed-tx-drill` signs locally from an owner-controlled mode-`0600` raw secp256k1 file, broadcasts only the public transaction bytes through loopback candidate RPC over strict SSH, and verifies the sender balance/nonce plus recipient balance on all four ABCI applications before rerunning common consensus evidence. The evidence records transaction hash, height, amount, fee, nonce, and converged account state, never the private key, and keeps public cutover unauthorized.
