# Custody Provider Readiness

The technical candidate covers the YNX Testnet/YNXT asset profile, dual account representation, secp256k1 ownership, canonical signed native transfer encoding, bounded fee/nonce rules, RPC capability matrix, deposit observation, withdrawal broadcast, deterministic public test vectors, and fail-closed package integrity.

It does not provide production key custody. Provider-controlled key generation, hot/warm/cold separation, quorum, recovery, rotation, staking/governance authority, signer installation, transaction approval, security contacts, upgrade notices, incident drills, and owner acceptance remain external controls. `make owner-handover-check` and `make production-custody-review-check` verify only the repository's fail-closed evidence contracts; they do not substitute for a completed ceremony or provider approval.
