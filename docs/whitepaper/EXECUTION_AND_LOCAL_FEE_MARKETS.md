# YNX Execution and Local Fee Markets

| Metadata | Value |
| --- | --- |
| Version | 0.1.1-candidate |
| Effective date | 2026-07-22 |
| Source commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Fee-ledger and shadow-market candidate reviewed | `9c2d39799b9eef0be06e3b04d4ffe2e9087cc5b8` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |
| Review status | Engineering and economic draft; independent review required |

## Direct answer

YNX Testnet currently executes deterministic native transfers and bounded signed
application actions through its accepted ABCI state machine. The native-transfer
path uses an exact fixed fee of one YNXT unit in the current integer accounting
model. A newer source candidate adds a committed fixed-fee event ledger and a
disabled StreamBFT shadow implementation of per-lane local fee markets. Neither
candidate is centrally integrated or active public policy.

This document separates current implementation facts from candidate fee-market
design requirements. It makes no Mainnet fee, validator-income, revenue, burn,
buyback, price, or yield promise.

## 1. Authoritative execution boundary

The authoritative result is the committed ABCI application state bound by
AppHash. Mempool admission, a Gateway response, an Indexer record, an Explorer
view, a wallet preview, or a third-party API is not final authoritative state.

The execution lifecycle is:

1. strict envelope decoding and signature verification;
2. stateless and stateful checks against a clone of committed state;
3. deterministic proposal filtering and ordered replay;
4. sequential application during block finalization;
5. state-invariant validation and AppHash calculation; and
6. atomic durable commit before the new state becomes authoritative.

All transaction and action types must fail closed on wrong chain, invalid signer,
malformed input, unauthorized transition, replay, stale nonce, inconsistent
idempotency, insufficient balance or resources, and version mismatch.

## 2. State model

Committed state version 7 contains:

- accounts, liquid balance, staked balance, nonce, resource use, and traceable lots;
- AI permission, action, and audit records;
- Pay intents, invoices, refunds, webhooks, events, and idempotency records;
- Resource quotes, delegations, rentals, income, events, sponsored pools, and audit;
- governance requests, Trust evidence, labels, appeals, corrections, and transparency;
- bounded contract identity, runtime storage, receipts, logs, and IDE idempotency; and
- the migration anchor and AppHash.

Collections whose order affects hashing are canonicalized or validated as unique
and sorted. Numeric state is checked for negativity and signed 64-bit overflow.
Liquid plus staked YNXT must remain equal to the migration-anchored total.

Height is persisted for restart recovery but excluded from AppHash; an empty
block that changes no application state retains the existing AppHash.

## 3. Native transfer execution

A valid native transfer binds chain ID, sender, recipient, amount, exact fee,
next nonce, compressed secp256k1 public key, and canonical low-S DER signature.
Its state transition is:

```text
require sender != recipient
require amount > 0
require fee == 1
require nonce == sender.nonce + 1
require sender.balance >= amount + fee

sender.balance    := sender.balance - amount - fee
recipient.balance := recipient.balance + amount
feeRecipient      := deterministic current validator recipient
feeRecipient.balance := feeRecipient.balance + fee
sender.nonce      := nonce
```

The implementation also updates bounded resource usage and deterministic lot
movement. State validation rejects any aggregate-supply change.

The integer labeled “YNXT” in this path is the runtime accounting unit exposed by
the current native model. Public interfaces must not silently reinterpret it as
a fiat value or claim an exchange rate.

## 4. Application action execution

Signed application actions extend deterministic state for AI approvals, Pay,
Resource, governance, Trust, and bounded developer workflows. Every action has a
type-specific sign document and validation rules. Depending on type, the action
may bind signer, account, session, scope, purpose, expiry, object version,
idempotency key, evidence hash, amount, or resource limit.

An action record cannot prove an external event outside its authority. For
example:

- an AI approval record does not prove a model call succeeded;
- a stablecoin intent does not execute mint or burn;
- a bridge coordinator finalization does not prove an external-chain transfer;
- a Pay intent does not prove settlement until the committed transaction matches;
- an evidence hash does not prove that an external legal or audit review occurred.

## 5. Bounded contract execution

The current developer path includes pinned-artifact bounded EVM-subset execution
for specifically supported contract workflows. It records deployed bytecode
identity, source hash, runtime mode, receipts, logs, storage, transaction hash,
block height, and audit hash.

This is not a claim of complete Ethereum Virtual Machine equivalence. Unsupported
opcodes, unbounded execution, arbitrary bytecode assumptions, universal gas
equivalence, and compatibility with every Ethereum tool remain outside the
proved subset.

## 6. Current fee classes

| Operation | Current engineering rule | Release interpretation |
| --- | --- | --- |
| Native signed transfer | Exact fee `1` YNXT unit | Implemented bounded Testnet rule; not a market quote |
| Local devnet contract deployment | Exact fee `10` YNXT units in the pragmatic devnet path | Development-only rule; not evidence of the ABCI production candidate’s final fee policy |
| Signed application actions | Type-specific expected fees where defined | Must be disclosed per action and source version |
| Third-party provider call | Provider cost is separate from protocol fee | Must identify provider, tariff source, observation time, estimate/actual class, and failure state |
| Venue or custody action | No generic fee inferred | Requires accepted provider/venue policy and user approval |

Fees must be displayed before approval with denomination, amount, recipient or
allocation rule, refundability, network, and freshness. A service must not hide a
spread or convert a provider cost into an undisclosed protocol fee.

## 7. Local fee market definition

A local fee market prices scarce execution or data capacity within a bounded
domain rather than forcing all domains to share one global bid. The reviewed
StreamBFT shadow candidate implements bounded per-lane base-fee transitions and
resource-fee arithmetic locally. It remains disabled, outside the accepted
central baseline, and without governed activation or public evidence.

Before implementation, each market must define:

| Dimension | Required decision and evidence |
| --- | --- |
| Resource | Exact metered unit: bytes, steps, storage, bandwidth, provider call, or another versioned unit |
| Domain | Transactions or actions that compete in the same market |
| Price formation | Base fee, posted price, auction, quota, or hybrid formula |
| Priority | Ordering rule and resistance to manipulation |
| Limits | Per-block, per-account, per-product, and global ceilings |
| User protection | Maximum authorized fee, expiry, cancellation, and stale-quote behavior |
| Allocation | Validator, protocol, provider, subsidy, refund, and burn treatment |
| Failure | Charge treatment for rejected, reverted, timed-out, or unknown outcomes |
| Congestion | Adjustment interval, bounds, and recovery after a spike |
| Upgrade | Version negotiation, old-client behavior, migration, rollback, and governance |

## 8. Candidate pricing constraints

Any future fee function must be deterministic from committed inputs or must bind
an authoritative signed quote with a clear expiry. It must not depend on an
unversioned wall clock, nondeterministic provider result, hidden operator input,
or mutable third-party response during consensus execution.

If a base-fee design is evaluated, the specification must identify target use
`T`, observed parent use `U`, prior base fee `B`, adjustment denominator `D`, and
hard minimum/maximum values. A candidate function such as

```text
B_next = clamp(B_min, B_max, B + trunc(B * (U - T) / (T * D)))
```

matches the form used by the reviewed shadow candidate, with checked unsigned
integer arithmetic and configured bounds. It is not the current public YNX fee
rule and must not enter public pricing claims without integration, simulations,
adversarial tests, economic review, governance approval, migration, and release
evidence.

## 9. Fair ordering and extractable value

The current proposer filters the incoming candidate order sequentially and does
not claim a public fee auction, encrypted mempool, batch auction, first-seen
guarantee, or maximal-extractable-value protection.

A future ordering policy must publish:

- proposer discretion and observable ordering inputs;
- treatment of equal-fee transactions;
- replacement and cancellation rules;
- replay and duplicate handling;
- private-order-flow and builder boundaries;
- sandwich, front-running, censorship, and denial-of-service threat models;
- inclusion and finality measurements; and
- monitoring and appeal procedures.

“FairFlow” must not be used as a performance or fairness claim until these rules
and adversarial results are directly evidenced.

## 10. Sponsored resources and subsidies

The resource model includes bounded sponsored pools with owner policy, allowed
beneficiary or scope, per-action and cumulative limits, expiry, unique action
references, pause, resume, revoke, unused-resource release, and audit. Sponsorship
consumes the approved resource allowance; it does not authorize arbitrary YNXT
movement or grant a Gateway signing identity.

Every subsidy must identify funding source, budget, eligible action, limit,
period, exhaustion behavior, and shutdown rule. Subsidized activity must not be
reported as organic revenue or hidden from unit economics.

## 11. Provider, venue, and application fees

YNX may disclose only a fee the user sees and accepts before the action, such as:

- protocol gas or resource fee;
- venue fee;
- provider cost;
- compute or data fee;
- subscription;
- management fee; or
- high-water-mark performance fee for an explicitly accepted managed service.

The disclosure must state source, effective period, gross/net treatment, included
and excluded costs, risk, lock, exit, network class, and evidence ID. A
performance fee must not apply to unrealized profit or reset its high-water mark
to charge the same recovery twice.

Hidden spreads, fabricated volume, wash trading, fabricated liquidity, guaranteed
returns, secret buybacks, hidden mint/burn, and describing burn as revenue are
prohibited.

## 12. Failure and unknown outcomes

Clients must distinguish:

- rejected before submission;
- accepted by a gateway but not observed in consensus;
- admitted to a mempool;
- included with success;
- included with failure;
- committed but temporarily absent from a derived index;
- expired or replaced; and
- unknown because authoritative verification is unavailable.

An unknown result must not trigger blind duplicate submission. Recovery uses the
signed transaction hash, sender, nonce, expected recipient, amount, fee, and
bounded finality search against authoritative state.

## 13. Measurements required before a dynamic fee claim

At minimum, a fee-market candidate requires reproducible workloads measuring:

- p50, p95, and p99 admission, inclusion, and finality latency;
- valid and invalid transaction throughput;
- proposal bytes and execution-resource saturation;
- mempool and application queue depth;
- fee volatility and user overpayment;
- proposer allocation and concentration;
- spam cost and legitimate-user displacement;
- state and index storage growth;
- behavior under one-validator loss and network delay; and
- old-client and rollback behavior across the fee-policy version boundary.

The report must include hardware, topology, dataset, duration, warm-up, source
commit, configuration, errors, raw output, and confidence/coverage. A local
four-node test must not be extrapolated into public production capacity.

## 14. Upgrade and compatibility

A fee-policy change is consensus-sensitive. The release must include:

1. a new policy and schema version;
2. activation height and governance authorization;
3. old-client response and transaction rejection behavior;
4. deterministic migration and rollback migration;
5. wallet fee-preview compatibility;
6. Indexer, Explorer, SDK, exchange, and custody updates;
7. monitoring thresholds and emergency pause conditions; and
8. public release notes and superseded-policy reference.

No operator or AI system may silently change fees, issuance, treasury allocation,
or risk limits.

## 15. Current evidence and limitations

| Evidence | Current result | Limitation |
| --- | --- | --- |
| Consensus migration check | Passed on 2026-07-22 for the reviewed source | Local deterministic fixture |
| Signed-transfer focused check | Passed on 2026-07-22 | Focused local tests, not public transfer evidence |
| ABCI test package | Passed after generating pinned Hardhat artifacts on 2026-07-22 | Initial clean-checkout run failed because generated artifacts were absent |
| Dynamic local fee market | Implemented and locally tested only in a disabled shadow candidate | Not central, governed, activated, deployed, or publicly evidenced |
| Fixed-fee event ledger | Implemented and locally tested on the reviewed fee candidate | Not central, deployed, indexed publicly, or reconciled by independent evidence |
| Mainnet fee policy | Not established | Requires economic, governance, security, and legal review |

## 16. Normative source map

| Concern | Source |
| --- | --- |
| Native envelope and fixed fee | `internal/consensus/transaction.go` |
| Proposal and finalization lifecycle | `internal/consensus/application.go` |
| State and AppHash invariants | `internal/consensus/state.go` |
| Current state transitions | `internal/chain/devnet.go`, `internal/consensus` action modules |
| Sponsored-resource authorization | `internal/chain/resource_sponsor.go`, consensus resource modules |
| Testnet identity | `chain-metadata/ynx-testnet.json` |
| Focused evidence commands | Consensus targets in `Makefile` |

## Change log

- 0.1.1-candidate (2026-07-22): Added the newer fixed-fee ledger and disabled
  StreamBFT per-lane market as explicitly non-central candidate evidence.
- 0.1.0-candidate (2026-07-22): Documented authoritative execution, current
  fixed fees, action and bounded-contract boundaries, local-fee-market design
  requirements, fair ordering, sponsorship, failure recovery, measurements, and
  upgrade constraints.
