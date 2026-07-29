# YNX Proof of Solvency Framework

| Metadata | Value |
| --- | --- |
| Version | 0.1.0-candidate |
| Effective date | 2026-07-22 |
| Accepted central source | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |
| Review status | Framework only; no solvency attestation is claimed |

## Direct answer

YNX does not currently publish a completed proof of solvency for an exchange,
custodian, stablecoin, bridge, managed vault, card program, or Treasury. Testnet
balances, on-chain reserve addresses without liabilities, self-reported provider
figures, intent records, and simulations are not proof of solvency.

## Required solvency equation

For a defined product, legal entity, asset, network and observation time:

```text
eligible controlled assets
  - customer and counterparty liabilities
  - senior claims and restricted balances
  - known pending withdrawals and settlement obligations
  - required operational and risk adjustments
  >= disclosed solvency threshold
```

Every term requires scope, valuation, control, ownership, encumbrance, freshness,
and evidence. A positive result for one asset or entity does not establish group-
wide solvency or liquidity.

## Scope declaration

A report must identify:

- legal entity and product;
- jurisdictions and reporting basis;
- included and excluded assets, liabilities and customer classes;
- canonical versus represented assets;
- networks, contracts, custody providers and bank accounts;
- observation timestamp and reporting period;
- valuation source, haircut and stale-price behavior;
- auditor/attestor identity and independence;
- exceptions, qualifications and subsequent events; and
- source commit and evidence IDs for software-generated portions.

## Asset evidence

Eligible evidence may include on-chain addresses with signed control challenges,
custodian statements, bank confirmations, contract state, and reconciled internal
ledgers. Assets must be reduced or excluded for encumbrance, lending, collateral,
pending settlement, bridge risk, withdrawal restrictions, sanctions freezes,
counterparty exposure, stale valuation, or unavailable evidence.

An address balance alone does not prove legal ownership, exclusive control,
availability for customer claims, or absence of borrowing.

## Liability evidence

Liabilities include customer balances, pending deposits and withdrawals,
unsettled trades, fees owed, provider and merchant settlement, redemptions,
chargebacks, refunds, disputes, loans, collateral and other senior claims.

A Merkle liability tree must define leaf encoding, balance sign and base unit,
duplicate-account prevention, negative-balance treatment, privacy protection,
root publication, inclusion verification, total reconciliation, correction and
appeal. A tree can prove inclusion in a published set; it cannot prove the set is
complete without independent controls.

## Liquidity and redemption

Solvency and liquidity are different. A solvent system may be unable to meet
immediate withdrawals. Reports must separately disclose liquid assets, maturity,
withdrawal queues, daily capacity, venue/counterparty limits, stress haircuts,
redemption timing, suspension conditions and emergency exit.

Stablecoin reserve and redemption claims additionally require issuer authority,
bank/custodian confirmation, reserve composition, segregation, frequency,
redemption eligibility, minimums, fees, time, holidays, sanctions/KYC controls,
insolvency treatment and independent attestation. The current non-executing
stablecoin control plane supplies none of those external facts.

## Bridge and represented assets

Represented assets require proof of locked/burned origin assets, canonical route,
message finality, relayer/custody control, mint/burn reconciliation, rate limits,
pending messages, liquidity, emergency pause and recovery. The current Bridge
coordinator finalizes only local intent state and has external submission
disabled; it is not reserve or solvency evidence.

## Managed vaults and strategies

Vault reports must reconcile wallet/vault assets, venue subaccounts, open orders,
positions, collateral, debt, unrealized PnL, accrued fees, withdrawal obligations,
mandates and high-water marks. Valuation must identify source, time, coverage and
failure. Strategy software must not gain arbitrary withdrawal or owner-change
authority.

## Privacy and abuse resistance

Proof must minimize personal data, avoid exposing individual balances, use
domain-separated commitments, prevent replay across periods/products, and define
retention and deletion. Independent reviewers require controlled access to source
records without publishing user identities or secrets.

## Publication record

Each attestation needs:

- immutable report and machine-readable manifest;
- report SHA-256 and byte count;
- exact observation and publication timestamps;
- source/data version;
- asset and liability totals by scope;
- coverage and unresolved exceptions;
- signer/attestor identity and signature class;
- verification instructions;
- superseded report link; and
- incident/correction contact.

## Current evidence gaps

| Product area | Current status |
| --- | --- |
| Exchange/custody | Candidate engineering exists; no production custody or complete liabilities proof |
| Stablecoin | Local non-executing review control plane; no issuer, reserve, redemption or attestation |
| Bridge | Local coordinator; external execution and liquidity disabled/absent |
| Managed vault/Quant | Candidate and paper workflows; no production custody or solvency report |
| Treasury | No audited general Treasury ledger or statement |
| Public proof-of-solvency artifact | Missing |

## Activation gate

No product may claim proof of reserves or solvency until assets and liabilities
are complete, reconciled, independently reviewed, privacy-tested, signed,
published immutably, and linked to a correction/incident process. Marketing must
state the exact scope and must not imply government insurance, guaranteed
withdrawals, profitability or zero risk.

## Change log

- 0.1.0-candidate (2026-07-22): Defined a non-claiming solvency framework for
  scope, assets, liabilities, liquidity, stablecoins, bridges, vaults, privacy,
  publication and current evidence gaps.
