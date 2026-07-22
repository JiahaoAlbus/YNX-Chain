# YNXT Tokenomics

| Metadata | Value |
| --- | --- |
| Version | 0.1.0-candidate |
| Effective date | 2026-07-22 |
| Accepted central source | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Economic candidate reviewed | `ff01dcee4c93acfb138dcde91f7605e408b706d5` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |
| Review status | Testnet and simulation disclosure; economic, governance, security, tax, accounting, and legal review required |

## Direct answer

YNXT is the native Testnet asset of YNX Testnet. The accepted runtime uses YNXT
for native balances, fixed transaction or application-action fees, staking state,
and defined resource-market accounting. YNXT is not presented here as a Mainnet
asset, investment, stablecoin, currency substitute, guaranteed store of value,
or source of guaranteed yield.

The current central runtime preserves migration-anchored liquid plus staked YNXT
supply and charges an exact fixed fee in its bounded native model. A reviewed
economic candidate adds a deterministic simulation policy and a local fixed-fee
event ledger. The simulation is not consensus policy; the ledger is not centrally
integrated or publicly deployed.

## 1. Asset identity and units

| Field | Current disclosure |
| --- | --- |
| Asset | YNXT |
| Network | YNX Testnet |
| EVM chain ID | `6423` / `0x1917` |
| Comet/Cosmos chain ID | `ynx_6423-1` |
| Metadata decimals | 18 |
| Current native execution arithmetic | Signed integer Testnet accounting units |
| Mainnet status | Not launched or established by this document |
| Represented monetary value | None claimed |

The reviewed economic simulator explicitly uses the current integer Testnet
accounting unit. Migration to a precisely specified 18-decimal base-unit model is
required before any consensus adoption of the candidate policy. Interfaces must
not mix display YNXT, base units, fiat estimates, or provider quote units.

## 2. Current authoritative supply rule

The accepted consensus migration records liquid and staked YNXT totals derived
from account state. Committed-state validation requires:

```text
sum(account liquid balance) + sum(account staked balance)
  = migration liquid supply + migration staked supply
```

Transfers, staking-state transitions, resource actions, and application actions
must preserve that invariant unless a separately versioned, governance-approved
issuance or burn transition is introduced. The current central source does not
implement a general issuance schedule or burn policy.

The exact Testnet genesis allocation is not published as finalized tokenomics in
the recovered evidence. Development fixtures, migration snapshots, faucet
balances, dry-run addresses, and simulation inputs are not a public allocation.

## 3. Allocation status

No final allocation is asserted for community, validators, foundation, team,
investors, ecosystem, grants, liquidity, treasury, or reserves. No circulating-
supply figure is asserted. Before any allocation claim, the release requires:

- exact total and base-unit denomination;
- recipient class and authority;
- vesting start, cliff, duration, cadence, and revocation rules;
- lock and transfer restrictions;
- source addresses or contracts;
- governance and conflict-of-interest approval;
- accounting and tax treatment;
- circulating-supply methodology;
- explorer-verifiable state; and
- legal review for every intended jurisdiction and distribution method.

Marketing materials must not convert an unapproved scenario into a pie chart or
circulating-supply claim.

## 4. Current fees

The accepted runtime uses a fixed `1` YNXT unit for the native transfer and
defined signed application-action path. The fee is credited under the current
deterministic validator rule. There is no active base-fee burn, priority fee,
per-lane market, protocol split, Treasury split, or general provider split.

A newer local candidate records each charged fee with payer, recipient, gross
amount, validator/provider/protocol/Treasury/burn allocations, block height,
source, observation time, and audit hash. Its current truthful allocation is:

| Allocation | Candidate fixed-fee ledger |
| --- | ---: |
| Validator | 100% |
| Provider | 0% |
| Protocol service revenue | 0% |
| Treasury | 0% |
| Burn | 0% |

That ledger is implemented and locally tested on the reviewed candidate commit,
but is not accepted central state, deployed public state, or independent revenue
evidence.

## 5. Economic policy candidate

The reviewed simulator defines deterministic basis-point arithmetic and these
public review defaults:

| Parameter | Candidate default |
| --- | ---: |
| Annual issuance floor | 1% |
| Annual issuance ceiling | 8% |
| Target staked ratio | 67% |
| Minimum validator count | 32 |
| Maximum largest-operator concentration | 20% |
| Base-fee burn | 100% of candidate base fee |
| Non-burn validator share | 70% |
| Non-burn provider share | 10% |
| Non-burn protocol service share | 10% |
| Non-burn Treasury share | 10% |
| Governance timelock | 7 days |
| Maximum annual parameter change | 1 percentage point |

These values are simulation parameters. They are not active, integrated,
governance-approved, deployed, or promised. The candidate has no hard supply cap;
it bounds annual issuance by the configured floor and ceiling.

## 6. Candidate issuance logic

The simulator begins at the issuance floor and can increase the candidate rate
when:

- the staked ratio is below target;
- the validator count is below the configured minimum; or
- the largest operator’s share is above the concentration bound.

Annual network fees reduce the modeled security subsidy according to a revenue-
offset parameter. The result is clamped to the configured floor and ceiling.
Integer arithmetic is deterministic and checked for invalid inputs and overflow.

This mechanism is an economic scenario tool, not a forecast. It does not model
token price, demand elasticity, validator costs, tax, market liquidity,
jurisdictional restrictions, user behavior, attack probability, or every
governance response. Its output cannot be labeled expected return.

## 7. Burn and revenue separation

Burn destroys supply. It is never revenue. The candidate distinguishes:

- base-fee burn;
- explicit service burn;
- validator revenue;
- provider revenue;
- protocol service revenue; and
- Treasury revenue.

Only the non-burn remainder may be allocated among revenue recipients. The four
candidate non-burn shares must sum to 100%. Any future public record must reconcile:

```text
gross fees
  = base-fee burn
  + validator allocation
  + provider allocation
  + protocol service allocation
  + Treasury allocation
```

Issuance, burn, transfers, and reclassification must remain separate ledger
events. Buyback, if ever proposed, must be disclosed as a treasury market action,
not burn or revenue, and must identify approval, counterparty/venue policy,
amount, price basis, conflicts, custody, and resulting asset disposition.

## 8. Staking and security budget

Current migration state includes staked balances, validator voting power, and a
resource-oriented staking path. It does not provide a complete validator or
delegator lifecycle. No APY is published.

A security budget cannot be inferred from an issuance rate alone. A complete
model must include validator hardware and operations, key custody, downtime and
incident burden, geographic and ownership concentration, commissions, delegation,
unbonding liquidity, slashing, insurance or safety-module coverage, taxes, fees,
and token-price uncertainty.

The 67% target, 32-validator minimum, and 20% concentration bound are candidate
simulation inputs, not current network performance claims.

## 9. Resource and service economics

The Resource Market has bounded provider and protocol-fee records in the existing
runtime. Those records apply to the exact resource workflow and must not be
generalized into chain-wide Treasury revenue.

Provider, compute, data, AI, storage, bridge, exchange, custody, payment, and card
costs must identify:

- service and provider;
- source and observation time;
- tariff or contract version;
- estimate versus invoice or committed charge;
- gross and net amount;
- user-approved fee;
- subsidy and funding source;
- refundability and failure treatment; and
- jurisdiction, tax, retention, and data-rights implications where applicable.

## 10. Capital and risk claim schema

Any public APY, PnL, yield, reserve, liquidity, burn, buyback, staking, vault, or
revenue statement must include all of these fields:

| Field | Requirement |
| --- | --- |
| Source | Authoritative record or named external source |
| Period | Exact start/end or observation timestamp |
| Gross / net | Both, with reconciliation |
| Costs | Protocol, venue, provider, custody, compute, data, tax assumptions |
| Risk | Market, liquidity, counterparty, smart contract, operational, legal |
| Drawdown | Measured period and method, or explicitly unavailable |
| Lock | Lock, vesting, unbonding, queue, or none |
| Exit | Withdrawal/redemption path, timing, limits, and failure state |
| Network class | Testnet, sandbox, simulation, staging, or production |
| Evidence ID | Stable evidence-index identifier |
| No guarantee | Explicit statement that outcomes are not guaranteed |

The current release publishes no APY, PnL, yield, reserve, liquidity, buyback, or
Mainnet revenue result.

## 11. Simulation disclosure

The repository’s example scenario uses user-supplied illustrative inputs,
including a one-billion-unit opening supply and five annual periods. Those values
are test data, not actual YNXT supply, allocation, fees, burn, validator count,
concentration, reserve, liquidity, revenue, or forecast.

Every simulation result must retain:

- `source=user-supplied-simulation-input`;
- exact `asOf` supplied by the scenario;
- policy and schema version;
- all input values;
- warnings that price, peg, liquidity, revenue, APY, and governance outcomes are
  not guaranteed; and
- the statement that burn is not revenue.

## 12. Governance controls

Candidate economic changes require a versioned proposal, exact parameter diff,
impact simulation, security and market-integrity analysis, legal review where
applicable, compatibility plan, activation height, timelock, rollback condition,
and public record. An emergency action may pause future activation but must not
mint outside the approved formula, rewrite historical accounting, bypass a user
mandate, or erase prior evidence.

AI may draft or explain a proposal. It cannot approve issuance, burn, buyback,
Treasury, staking, fee, or risk changes.

## 13. Required evidence before adoption

The simulation candidate cannot become consensus policy until all applicable
evidence exists:

1. base-unit and rounding specification;
2. genesis and circulating-supply disclosure;
3. issuance and burn state transitions;
4. per-lane or global fee-market implementation and adversarial tests;
5. validator/delegator staking lifecycle;
6. Explorer and Indexer reconciliation;
7. migration, old-client, rollback, backup and restore drills;
8. economic simulations over multiple demand, price, concentration, attack, and
   provider-cost scenarios;
9. independent security and economic review;
10. governance approval and timelock; and
11. staging and public evidence tied to the activated source commit.

## 14. Current release-state truth

| Capability | Implemented locally | Tested locally | Integrated centrally | Deployed publicly |
| --- | --- | --- | --- | --- |
| Current fixed-fee transfer rule | Yes in accepted source | Yes | Yes for accepted baseline | Historical public observations exist; current independent proof remains incomplete |
| Fixed-fee allocation ledger | Yes on reviewed candidate | Yes on candidate | No | No |
| Economic simulator | Yes on reviewed candidate | Yes on candidate | No | No |
| Dynamic issuance | Simulation only | Simulation only | No | No |
| Base-fee burn | Candidate formula only | Simulation arithmetic only | No | No |
| Final allocation | No | No | No | No |
| Validator/delegator staking lifecycle | No | No | No | No |
| Liquid staking and Safety Module | No | No | No | No |
| Treasury governance ledger | No | No | No | No |

## 15. Evidence map

| Topic | Reviewed source |
| --- | --- |
| Accepted supply invariants | `internal/chain/consensus_migration.go`, accepted committed-state validation |
| Accepted fixed transfer fee | `internal/consensus/transaction.go` |
| Candidate economic policy | `economics/ECONOMIC_POLICY.md`, `internal/economics/model.go` on the reviewed candidate commit |
| Candidate fee ledger | `internal/consensus/fee_state.go` on the reviewed candidate commit |
| Stablecoin boundary | `docs/stablecoin/STABLECOIN_ISSUER_READINESS.md` |
| Product fee boundaries | `docs/whitepaper/EXECUTION_AND_LOCAL_FEE_MARKETS.md` |
| Completion evidence | `docs/acceptance/FEATURE_COMPLETION_EVIDENCE.md` |

## Change log

- 0.1.0-candidate (2026-07-22): Established YNXT identity, current supply and fee
  truth, missing allocation, simulation-only issuance and burn defaults, staking
  and service boundaries, capital-claim schema, governance controls, adoption
  gates, and release-state evidence.
