# Owner Custody Handover

YNX Chain separates public identity inventory from secret transfer. The handover packet contains public validator identities, public service-signer addresses, explicitly classified runtime/test accounts, source hashes, and default-false custody status. It never reads or stores private key bytes.

The four CometBFT validators and five future BFT service signers require owner handover. The current authoritative `ynx_faucet` identity is runtime state rather than a cryptographic wallet, so it has no mnemonic or private key to transfer. The public address proof account is a funded smoke-only test identity whose key is publicly known and unsuitable for production custody. Timestamped `ynx_remote_smoke_*` identities are ephemeral runtime records, not wallets.

Generate a packet only from the mode-`0600` public validator manifest, service-signer public manifest, and service ceremony status:

```bash
YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST=/absolute/path/to/validator-manifest.json \
YNX_OWNER_HANDOVER_SERVICE_SIGNER_MANIFEST=/absolute/path/to/service-signers.json \
YNX_OWNER_HANDOVER_SERVICE_SIGNER_STATUS=/absolute/path/to/CEREMONY_STATUS.json \
YNX_OWNER_HANDOVER_OUTPUT_DIR=/absolute/owner-controlled/output \
make owner-handover-packet
```

The generated `inventory.json`, `receipt.template.json`, and `HANDOVER_REQUEST.md` are mode `0600` and non-overwriting. The inventory digest binds every public identity and source hash. The receipt defaults recovery, handover, and rotation assertions to false. A completed receipt requires a named owner, a different independent reviewer, exact recovery/handover/rotation references, and a validity window no longer than seven days.

`make owner-handover-check` uses disposable public fixtures. It verifies identity counts, dual-format service addresses, runtime/test boundaries, digest binding, file modes, non-overwrite behavior, and rejection of tampering, stale commits, self-review, duplicate signers, and funded identities with unknown ownership.

A valid receipt is evidence for later independent custody review only. It does not install service signers, transfer funds, authorize a transaction, or make the network BFT-ready. Offline service-signer recovery must use a different owner-controlled encrypted medium; the existing same-volume recovery staging copy is not sufficient.

After a receipt validates, pass the inventory and receipt to `make production-custody-review-packet` through `YNX_OWNER_HANDOVER_INVENTORY` and `YNX_OWNER_HANDOVER_RECEIPT`. The custody packet copies and revalidates both files, requires its reviewer to differ from the owner and handover reviewer, and propagates exact owner evidence hashes into later freeze/cutover validation. An unacknowledged template cannot generate a production custody review packet.
