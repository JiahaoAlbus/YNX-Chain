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
