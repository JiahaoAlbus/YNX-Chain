# Production Service Signer Ceremony

YNX Chain uses five distinct secp256k1 signer roles for the future BFT-mode Faucet, AI, Pay, Trust, and Resource services. These are raw 32-byte keys, not mnemonic phrases. Private files must never be printed, committed, attached to public proof, or copied into environment variables.

`make production-service-signer-ceremony-plan` is non-mutating. `scripts/ops/init-production-service-signers.sh` supports explicit `create` and `verify` modes only when two absolute directories outside the Git repository are supplied. Create mode also requires `YNX_SERVICE_SIGNER_CEREMONY_APPROVED=yes`. It creates five mode-`0600` owner-local keys, a second owner-designated recovery staging copy, role-specific public address records, a public manifest, and a status record. Existing output directories are never overwritten.

`make production-service-signer-ceremony-check` uses disposable keys to prove distinct addresses, restrictive modes, recovery-copy equality, non-overwrite behavior, and tamper rejection. It does not install or fund a key.

The first ceremony was generated on a non-FileVault startup volume, never uploaded or funded, then abandoned and deleted. Its identities are forbidden for production use. The active owner-local ceremony was regenerated directly on the separate FileVault-protected volume at `/Volumes/Data/Users/huangjiahao/.ynx-chain-custody/production-service-signers/service-signers-20260713T101647Z`. Its public manifest SHA-256 is `89ea82399b1c9907d5ed4a61132dceb068d0fbe136c1e7780b2e88b654d69ae3`. The `recovery-staging` directory is encrypted at rest but remains on the same volume and is not claimed as an offline backup. Remote install, offline recovery, owner handover, rotation, and independent review remain false.

Before remote installation:

1. Move one recovery copy to an owner-controlled offline encrypted medium without exposing key bytes in logs or chat.
2. Restore that copy into a temporary mode-`0700` directory and run ceremony `verify` against the owner-primary copy.
3. Record owner handover and rotation evidence outside Git; only its non-secret reference may enter an approval file.
4. Obtain a custody reviewer different from the transaction approver.
5. Install only the five exact reviewed keys as `ynx:ynx` mode `0600` under `/etc/ynx/consensus-signers` through a separately reviewed, rollback-capable operation.

Rotation creates a new ceremony directory and five new public identities. Do not overwrite the current owner keys or replace server files in place without a transaction-bound backup, service-address update, continuity verification, and rollback path. No signer is active in public BFT mode today.
