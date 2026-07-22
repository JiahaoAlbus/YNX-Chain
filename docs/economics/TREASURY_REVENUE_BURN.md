# YNX Treasury, Revenue, Burn, and Buyback Disclosure

| Metadata | Value |
| --- | --- |
| Version | 0.1.0-candidate |
| Effective date | 2026-07-22 |
| Accepted central source | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Economic candidate reviewed | `ff01dcee4c93acfb138dcde91f7605e408b706d5` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |
| Review status | Accounting-policy candidate; not a Treasury statement or audit |

## Direct answer

YNX does not currently publish a versioned general Treasury governance ledger,
audited Treasury balance, protocol-wide revenue statement, active burn program,
or buyback program. The existing Resource Market can record a bounded protocol
fee for that workflow. A reviewed economic candidate simulates burn and fee
allocation, but the policy is not centrally integrated, activated, or deployed.

## Definitions

| Term | Meaning |
| --- | --- |
| User principal | User-owned assets; never YNX revenue merely because a service can observe or route them |
| Gross fee | Total fee charged for the exact action before allocation |
| Provider cost | Amount owed to an identified external or internal service provider |
| Validator revenue | Fee or issuance amount allocated to validator operations under active policy |
| Protocol service revenue | Earned consideration for an identified YNX service, excluding burn and user principal |
| Treasury inflow | Asset received by an authorized Treasury address or account under an approved policy |
| Burn | Irreversible supply destruction under a versioned protocol rule |
| Buyback | Treasury purchase of an asset; not burn unless a later independently recorded destruction occurs |
| Subsidy | Treasury/foundation/provider-funded user cost; not organic revenue |

## Current authoritative boundary

- The accepted native fee is credited under the current validator rule.
- The Resource Market can allocate a workflow-specific provider amount and
  protocol-resource-treasury amount with linked records.
- No active general base-fee burn exists.
- No secret or public buyback program is established.
- No Mainnet Treasury policy, multisignature ceremony, audited balance, runway,
  or public financial statement is established.

## Candidate allocation

The economic simulation candidate burns 100% of its modeled base fee and splits
the non-burn remainder 70% validators, 10% providers, 10% protocol service, and
10% Treasury. These are review parameters only. The current fixed-fee ledger
candidate instead records 100% validator allocation and zero burn/provider/
protocol/Treasury amounts, matching present runtime behavior.

## Required ledger

Every revenue, Treasury, burn, or buyback record must identify:

- stable event and audit ID;
- source transaction or invoice;
- source, observation time and policy version;
- asset, base unit and network;
- gross amount;
- validator, provider, protocol, Treasury, refund, subsidy and burn allocation;
- counterparty and authority class where disclosure is lawful;
- accounting classification and period;
- governance approval and effective time;
- related-party or conflict disclosure;
- resulting on-chain transaction or state commitment; and
- explicit failure/reversal state.

The allocation must reconcile exactly. Burn cannot appear in a revenue total.

## Treasury authority

A Treasury implementation requires named roles, threshold approval, hardware or
institutional signer custody, transaction limits, allowlists, timelocks,
separation of proposal and execution, emergency pause, key rotation, recovery,
conflict controls, audit retention and public reporting. No AI system may approve
or execute a Treasury transaction.

No operator should disclose private keys, seed phrases, PEM material, validator
keys or complete API secrets in documentation or chat.

## Buyback policy boundary

A buyback proposal must disclose purpose, maximum amount, time window, source of
funds, venues/counterparties, price and slippage controls, market-abuse review,
conflicts, custody, resulting asset treatment, cancellation and reporting. It
must not promise price support or conceal purchases. Purchased assets are not
burned unless a distinct verifiable burn event follows.

No buyback is approved or active by this document.

## Financial and risk reporting

Reports must distinguish observed committed amounts, provider invoices, bank or
custody statements, estimates, simulations and forecasts. Each report states
period, gross/net, costs, tax assumptions, exchange-rate source, volatility,
liquidity, counterparty, custody, legal and operational risks, and evidence ID.

Testnet balances and simulated values are not company assets, revenue, reserves,
cash flow, runway or valuation.

## Governance and change control

Fee allocation, issuance, burn and Treasury policy changes require versioned
proposals, simulations, independent review, exact diffs, timelock, activation,
rollback and public change logs. Historical events must not be rewritten when a
policy changes.

## Current release-state truth

| Capability | State |
| --- | --- |
| Workflow-specific Resource protocol-fee record | Implemented in accepted source for that bounded workflow |
| General fixed-fee allocation ledger | Local candidate only |
| General Treasury governance ledger | Not implemented |
| Active base-fee burn | Not implemented |
| Buyback | Not approved or active |
| Audited Treasury balance/revenue statement | Not available |
| Mainnet Treasury policy | Not established |

## Change log

- 0.1.0-candidate (2026-07-22): Defined current boundaries, accounting terms,
  candidate allocation, required ledger and Treasury authority, buyback controls,
  financial reporting, governance and release-state truth.
