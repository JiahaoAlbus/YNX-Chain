# Chain Core Strategy Vault v1.35 consumption contract

Status: **consumed as a fail-closed product boundary; no product-owned public execution evidence yet.**

This finance-suite handoff consumes, but does not modify, Chain Core authority:

- implementation: `6f380265c7d3cc055984e33082f877b4e75303d5`
- contract: `144bc1a354ba390c0ae4e17a93597f799e57c3d6` (`1.35.0`, 110 vectors)
- package: `e37750326`
- delivery bundle: `release/local-delivery/chain-core-data-commitment-v35.bundle`
- bundle SHA-256: `340d7572eee0a36b2cb9b0402abd36ad9ff7d206a56ad92d0db22728e7af607f`

## Non-negotiable custody invariants

1. A persisted vault owner equals its referenced `StrategyMandate` owner.
2. A closed vault has zero YNXT.
3. Only the owner may withdraw or emergency-exit. Engines may submit only scoped actions; they cannot withdraw, change owner, or widen a mandate.
4. Funding rejects revoked, expired, killed, or closed mandates/vaults. Rejected mutations are atomic.
5. Product acceptance must cover Chain Core custody vectors 487–563, including `strategy-vault-custody-invariant-reject`.

## Current product behavior

DEX, Exchange and Quant public execution are disabled by default. Their health/error protocol exposes the gate `chain_core_strategy_vault_v1_35_product_evidence` / `strategy_vault_custody_evidence_required`. Market reads, portfolio reads, research and paper behavior remain distinct and do not imply custody or execution.

DEX no longer accepts `YNX_DEX_STRATEGY_VAULT_EVIDENCE` (or any other process
environment toggle) as an execution release condition. The current binary is
compiled fail-closed. A future product release must add a signed,
source-bound verifier that checks all evidence below; it cannot replace this
boundary with a local bundle, generic RPC success, Wallet availability, a
populated market, or a configuration string.

## Required future acceptance evidence

- public Chain Core runtime/source identity matching the pinned contract;
- two independent owner accounts: owner-match accept and owner-mismatch reject;
- closed-vault zero-YNXT reject/accept boundary;
- engine withdrawal, owner-change and mandate-widen attempts rejected atomically;
- Exchange/DEX route transaction/order hashes and Explorer locations;
- Quant engine action signed by its engine identity, reconciled without custody movement;
- source commit/build SHA, public probe, rollback target and UI evidence.

Central Website/Wallet owners should display the products as **read-only/research available; Testnet execution unavailable pending v1.35 product evidence**. This document is a handoff, not a change to their directories.
