# Governance Integration Handoff

Owner: `31-governance`  
Source commit: `89edb99d1ec0ee00d92dd0a0d965c6c88daba31d`  
Branch: `codex/final-governance`  
Lifecycle: `ACTIVE`  
Current phase: `INTEGRATE`

## Accepted local facts

- Governance owns proposal, vote, delegation, timelock, upgrade, canary,
  emergency, appeal and governance-audit semantics.
- The authoritative parameter and role registries fail closed on drift.
- Signed execution intents use the Chain Core / Comet adapter and receipt
  verification binds transaction, block, state root, manifest, source, outcome
  and audit identity.
- The multiprocess four-validator lifecycle is local Testnet evidence. It is not
  a public-chain transaction or public deployment.
- The standalone read-only UI consumes real public APIs and contains no fake
  Wallet or unsigned-vote success path.

## Central acceptance boundary

Integration may accept this source only after the exact Wallet/Product Session,
Data Fabric events, Explorer receipt lookup, Monitor alerts, Trust appeal,
Security/SRE custody and public Website status contracts pass together.
Governance must not implement compatibility auth, a second ledger, a second
release authority or direct signer custody.

## Required central actions

1. Register the exact Governance product binding in Wallet/Auth and App Gateway.
2. Register the canonical Governance events with Data Fabric.
3. Index proposal, vote, timelock, execution, rollback and emergency evidence.
4. Alert on stuck timelocks, failed canaries, receipt mismatch and emergency
   expiry.
5. Link correction and appeal evidence through Trust without granting Trust
   governance execution authority.
6. Execute the cross-product vectors in this directory and retain exact receipts.

Public, production, Mainnet, audit and independent-acceptance states remain false.
