# Governance Integration Handoff

Owner: `31-governance`
Source commit: `cd328bd5817f32efba259e0ad8948f202ebaf654`
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

## Website acceptance evidence

A bounded public probe on 2026-07-29 found that `https://ynxweb4.com/governance`
redirects to `https://www.ynxweb4.com/governance` and returns HTTP 200, but the
HTML is the generic root application shell with title `YNX Chain — Web4 Layer-1
Ecosystem` and canonical `https://ynxweb4.com/`. This is not a Governance
product page and does not satisfy public deployment or Website acceptance.

Product 28 must consume `release/governance/public-product-metadata.json` and
`release/governance/product-release.json`, render a Governance-specific title,
canonical URL, H1, status, evidence, API, support and security destinations, and
expose the accepted source commit. The raw machine-readable observation is
`release/evidence/governance-public-route-probe-2026-07-29.json`.

Public, production, Mainnet, audit and independent-acceptance states remain false.
