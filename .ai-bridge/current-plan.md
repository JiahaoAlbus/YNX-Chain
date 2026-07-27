# YNX 17 Economics Current Plan

## State

- Product: YNXT Economics / Treasury / Stablecoin
- Phase: INTEGRATE
- Goal: Active
- Frozen Integration Bundle source: `72591ce6ab9eb4ae7878fcf6369c9aac37e7fba9`
- Local Testnet evidence runtime source: `f14d002a39cedca18b094e856adc7da888d376da`
- Unsigned CLI artifact source: `175eaec4b04f22bdb5aa2652bb7d69921beb6e06`
- Shared Testnet acceptance validator source: `e1271acfb6b0959b1cfd11ce7b9144d66e1edec8`

## Protected completion

The unsigned Darwin arm64 Testnet CLI package has reproducible double-build, install, cold-start, restart, removal and persisted SHA-256 evidence. It remains unsigned and unhosted.

The shared Testnet acceptance validator now requires exact Economics and independent 01/12/13/26/29 source commits, canonical-order Ed25519 owner attestations, bounded proof age, committed BFT proof fields, exact Store/Data Fabric counts, HTTPS Explorer/Monitor evidence and evidence-bounded release states. Missing, duplicate, reordered, stale, future-dated, rebound, tampered and over-promoted evidence fails closed. No real owner acceptance or shared-Testnet transaction is attached yet.

## Next slice

Implement a versioned acceptance CLI and 0600 persistence path that load an operator-supplied policy and evidence document, call the validator, persist only verified summaries, reject replay/rebinding/tamper on restart, and support a restore drill. Do not embed owner private keys or fabricate owner evidence.

After that, hand the schema and negative vectors to 01 Chain Core, 12 Explorer, 13 Monitor, 26 Data Fabric and 29 Integration for direct signed acceptance records.
