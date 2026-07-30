# YNX Staking, Liquid Staking, and Safety Module

| Metadata | Value |
| --- | --- |
| Version | 0.1.0-candidate |
| Effective date | 2026-07-22 |
| Accepted central source | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Economic candidate reviewed | `ff01dcee4c93acfb138dcde91f7605e408b706d5` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |
| Review status | Gap and design disclosure; not an activated staking-economics policy |

## Direct answer

YNX Testnet currently records account-level staked YNXT and validator voting
power. It does not yet provide a complete validator/delegator lifecycle, reward
and commission accounting, unbonding and withdrawal queues, slashing and jail
evidence, liquid-staking token, or Safety Module. No staking APY, redemption
ratio, depeg protection, or loss guarantee is claimed.

## Current implemented boundary

- Migration state records liquid and staked YNXT totals.
- Account state records `balance`, `staked`, nonce, resources, and lots.
- Total liquid plus staked YNXT is conserved by committed-state validation.
- Validator records include identity, voting power, active status, and consensus
  key binding where configured.
- Existing resource-oriented staking actions are not a complete delegator
  economics or validator reward system.

## Missing validator and delegator lifecycle

Before public activation, the protocol must define and implement:

| Area | Required behavior |
| --- | --- |
| Validator admission | Eligibility, identity, keys, self-bond, commission, ownership and concentration disclosure |
| Delegation | Signer authority, validator selection, amount, receipt, redelegation and cancellation |
| Rewards | Exact source, accrual, rounding, distribution, claim, compounding and tax data |
| Commission | Maximum, change limit, effective time, notice, conflicts and evidence |
| Unbonding | Queue order, duration, capacity, cancellation, partial exit and emergency behavior |
| Slashing | Objective fault, evidence, amount, scope, correlation, appeal and governance boundary |
| Jail and re-entry | Trigger, duration, remediation, reactivation and public record |
| Key rotation | Consensus and operator key ceremony, overlap, rollback and compromised-key handling |
| Exit | Validator and delegator withdrawal, residual obligations, records and service sunset |

## Reward and APY disclosure

A staking return can come from issuance, transaction fees, service fees, or other
explicit sources. Each source must be accounted separately. An APY claim requires
source, exact period, compounding method, gross and net value, commission, fees,
lock/unbonding, token-price risk, slashing risk, validator performance, drawdown,
network class, evidence ID, and no-guarantee language.

No current value satisfies that schema. The economic simulator’s issuance rate
is not staking APY.

## Candidate security-budget parameters

The reviewed simulation candidate uses a 67% target staked ratio, minimum 32
validators, and maximum 20% largest-operator concentration. These are review
inputs designed to test security-budget pressure. They are not current network
statistics, admission rules, decentralization proof, or promised targets.

## Liquid staking requirements

No liquid staking implementation is recovered. A candidate must define:

- deposit and mint exchange rate;
- underlying validator allocation and concentration limits;
- reward, commission, and fee accounting;
- slash and socialized-loss treatment;
- unbonding and withdrawal queue;
- instant-exit liquidity source and spread;
- oracle and price-source boundary;
- depeg, insolvency, validator failure, bridge, and smart-contract risks;
- pause, kill switch, emergency exit, upgrade and recovery;
- custody, governance, audit and legal status; and
- reserves/liabilities reconciliation without describing protocol staking as a
  fiat-backed reserve.

Liquid-staking tokens must not be marketed as equivalent to YNXT or as guaranteed
one-to-one redemption.

## Safety Module requirements

No Safety Module or service security pool is implemented. A future module must
identify exactly which losses it can cover, funding source, eligible claims,
exclusions, priority, deductible, maximum payout, depletion behavior, governance,
conflicts, assessment evidence, appeal, recovery/subrogation, and sunset.

Safety-module deposits expose users to loss and lock risk. They are not insurance
unless an appropriately authorized legal arrangement says so after review.

## Asset and authority boundary

- Validator software and services must never receive a user seed phrase.
- Delegation authority must not include arbitrary withdrawal or owner change.
- Liquid-staking or safety contracts must not grant an AI, browser, frontend, or
  provider unrestricted signing authority.
- Every mandate requires limits, expiry, nonce domain, immediate revocation,
  kill switch, emergency exit, audit and recovery.
- Stablecoin issuer control must not govern native YNXT stake or validator bonds.

## Evidence required before activation

1. Versioned schemas and deterministic state transitions.
2. Conservation, rounding, replay, nonce, overflow and authorization tests.
3. Queue saturation, mass exit, slash, depeg and insolvency simulations.
4. Old-client compatibility, migration and rollback migration.
5. Backup, restore and emergency-exit drill.
6. Explorer-visible validator, delegation, reward, slash and queue records.
7. Threat model, audits, SBOM and reproducible artifacts.
8. Economic, legal, tax, accounting and custody review.
9. Staging deployment and public Testnet evidence.
10. Governance approval and user-facing risk acceptance.

## Current release-state truth

| Capability | implementedLocal | testedLocal | integratedCentral | deployedPublic |
| --- | --- | --- | --- | --- |
| Staked-balance and validator migration state | true | true | true | Current independent proof incomplete |
| Complete delegation lifecycle | false | false | false | false |
| Reward and commission ledger | false | false | false | false |
| Unbonding and withdrawal queue | false | false | false | false |
| Slashing and jail lifecycle | false | false | false | false |
| Liquid staking | false | false | false | false |
| Safety Module | false | false | false | false |

## Change log

- 0.1.0-candidate (2026-07-22): Published current staking-state truth, missing
  lifecycle, reward/APY rules, candidate security parameters, liquid-staking and
  Safety Module requirements, authority boundaries, and activation evidence.
