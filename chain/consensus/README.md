# Consensus

YNX Chain currently pins CometBFT `v0.38.23` and exposes the application through ABCI 2.0 in `cmd/ynx-abci`.

`ynx-chaind --export-consensus-state <path>` creates the deterministic migration anchor. Start the ABCI application with:

```bash
ynx-abci -migration-state <migration.json> -state <abci-state.json>
```

The native transaction envelope is canonical JSON signed with secp256k1 ECDSA. Its address is the lowercase EVM-compatible `0x` address derived from `keccak256(uncompressed_public_key[1:])`. Signing is domain-separated by `YNX_NATIVE_TX_V1` and binds version, numeric chain ID, transfer type, sender, recipient, amount, fixed fee, next nonce, and compressed public key. Private keys are never stored by the ABCI application.

`CheckTx`, `PrepareProposal`, `ProcessProposal`, and `FinalizeBlock` verify signatures and apply transfers sequentially. Execution preserves total YNXT supply, increments nonce and bandwidth usage, moves traceable lots in sorted order, and assigns the current fixed fee to the first active validator in the sorted migration set. The committed account state and AppHash are atomically stored with mode `0600`; a failed disk commit does not advance in-memory height.

Run `make consensus-migration-check`, `make consensus-abci-check`, and `make consensus-signed-transfer-check` for local evidence.

This is not four-validator quorum proof. Validator consensus public-key mapping, generated CometBFT homes, multi-node voting, validator stop/restart proof, remote deployment, and rollback drills remain incomplete.
