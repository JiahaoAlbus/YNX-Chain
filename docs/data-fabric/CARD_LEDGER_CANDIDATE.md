# Card Ledger Contract — Candidate

Status: `CANDIDATE`; activation is prohibited until Integration accepts the
contract and issues a Data Fabric lease. These files do not activate a Card
runtime, alter Financial Apps, or claim a payment-network deployment.

The scope is Testnet simulation only:

`YNXT Testnet top-up → simulated balance → authorization → capture/reversal/refund → fee → reconciliation`.

Candidate artifacts:

- `schemas/data-fabric/durable-ledger-v1.candidate.schema.json`
- `schemas/data-fabric/card-ledger-events-v1.candidate.schema.json`
- `schemas/data-fabric/card-ledger-events-v1.candidate.vectors.json`

`card.funded` becomes `completed` only after a finalized YNX Testnet transaction
and authoritative receipt. A deep link, intent, or application callback cannot
create a completed funding event.

The ledger candidate requires an immutable journal with explicit debit and
credit legs, event references, correction references, and reconciliation state.
For every asset, journal debits and credits must balance. Corrections are new
reversal entries; historical entries are not updated.

No PAN, CVV, track data, PIN, card cryptogram, magnetic-stripe data, or raw
payment-card material is allowed. A future real-card integration must use a
tokenized card reference and separate approved custody controls.
