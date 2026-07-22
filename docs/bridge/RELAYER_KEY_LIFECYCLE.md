# Bridge Relayer Key Lifecycle

Status date: 2026-07-23.

Each configured Ed25519 public key is a verification trust root, not a destination signer or user-asset key. The coordinator never accepts or stores relayer private keys. Relayer signing may eventually use an HSM or MPC service outside this process, but no production device, custody ceremony, guardian set, or signer authority is established here.

At startup, every persisted attestation is reverified against its configured relayer name and public key. Validation binds the transfer ID and intent digest, source block, confirmation count, canonical payload hash, signature, timestamp, threshold status, finalization state, matching audit event, and source-event index. A separately resealed file with fabricated quorum evidence fails closed.

Replacing a configured public key while historical signatures for that relayer remain in state causes startup failure. This is intentional: ordinary configuration editing must not rewrite historical identity. A future production rotation requires a versioned key registry that retains old verification-only public keys, an approved activation height/time, overlap and rollback windows, threshold/guardian approval, HSM/MPC attestation where applicable, immutable ceremony evidence, restart and restore drills, and removal only after retention and dispute obligations permit it.

Until that versioned registry exists:

1. Pause new mutations before any relayer maintenance.
2. Record source commit, binary hash, state hash, active key fingerprints, threshold, and incident/change reference.
3. Back up and restore-test the exact state and configuration.
4. Do not overwrite an active relayer identity with a new key.
5. If a key is suspected compromised, keep the Bridge paused and preserve evidence; do not claim rotation or resume external activity.
6. Require a separately reviewed migration implementation and ceremony before changing trust roots with historical attestations.

This control protects historical verification but is not production key rotation, HSM certification, MPC custody, guardian approval, or canonical-bridge security.
