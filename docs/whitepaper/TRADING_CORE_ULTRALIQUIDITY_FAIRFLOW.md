# Trading Core, UltraLiquidity, and FairFlow

Version: 0.1.0-candidate  
Effective date: not effective  
Last reviewed: 2026-07-22  
Source commit: `719e1018267ed5a53e6fae5211c5fd8a1503c35c`  
Product release: research and interface specification; no deployed trading venue

## Direct answer

YNX does not currently evidence a live exchange, DEX, shared-liquidity network, or production matching engine. “UltraLiquidity” and “FairFlow” name candidate design goals: truthful venue aggregation and auditable order handling. They are not claims of deep liquidity, best execution, fairness, zero slippage, or guaranteed fills.

## Asset boundary

User assets may remain only in a user Wallet, a named exchange subaccount, a user-controlled strategy vault, an approved custody provider, or an approved protocol contract. The trading service, AI layer, browser, and analytics engine must not receive seed phrases, private keys, arbitrary withdrawal rights, owner-change authority, or a mandate wider than the user approved.

Every venue adapter declares custody model, chain/network, asset identity, quote source, authentication, order types, fees, limits, jurisdiction, terms, retention, health, and outage semantics. A third-party quote or balance is labeled with provider, `asOf`, version, coverage/confidence where relevant, and stale/unavailable state. It never replaces canonical Wallet ownership or chain settlement evidence.

## Candidate trading lifecycle

1. Discover approved venues and normalize asset identifiers without merging economically different assets.
2. Obtain timestamped quotes and order-book coverage with explicit fees, gas, latency, depth, and source.
3. Simulate route, price impact, failure cases, allowance/mandate use, and worst-case user debit.
4. Show a confirmation containing gross amount, all costs, minimum received or limit price, expiry, venue/custody, and risks.
5. Require canonical Wallet approval bound to product, device, account, exact action, limit, expiry, and nonce domain.
6. Submit only within the mandate and record provider acknowledgement separately from execution and settlement.
7. Reconcile fills, fees, balances, receipts, and exceptions from authoritative sources.
8. Release unused authority and support cancellation, revocation, dispute evidence, and emergency exit where technically possible.

## FairFlow rules

Candidate FairFlow requires deterministic priority rules published before use; no hidden order reordering; no undisclosed principal trading; no secret spread; no wash trading or fake volume; no payment-for-order-flow omission; no preference based on protected or unrelated user data; and an auditable record of receipt time, normalized order, route decision, user approval, venue response, fill, fee, and settlement reference.

If private order flow, batching, auctions, MEV protection, or sequencer discretion is proposed, its trust assumptions, leakage risks, censorship path, tie-breaking, clock source, replay behavior, and appeal process must be specified and independently tested. “Fair” cannot be inferred from encryption or batching alone.

## UltraLiquidity rules

Liquidity figures must identify venue, pair, side, depth band, timestamp, executable size, fees, and exclusions. Aggregated depth must not double-count mirrored or routed liquidity. A provider timeout, stale quote, crossed book, insufficient approval, custody outage, chain reorganization, or reconciliation mismatch returns an unavailable/partial result instead of synthetic depth or success.

Marketing must not publish liquidity, volume, spread, execution improvement, or fill-rate statistics without a period, methodology, raw-source lineage, bot/test exclusions, sample coverage, and evidence ID. Paper trading and simulator results remain labeled as such.

## Fees and performance

Before approval, disclose gas, venue fee, provider cost, compute/data charge, subscription, management fee, and high-water-mark performance fee separately when applicable. No fee may be charged on unrealized profit, silently embedded as spread, or reset to charge the same gain twice. User PnL belongs to the user unless a separately approved managed-vault contract says otherwise. Returns are never guaranteed.

## Risk and recovery

Risks include market loss, slippage, partial fills, stale data, venue insolvency, custody failure, smart-contract defect, oracle manipulation, bridge failure, sanctions or jurisdictional restriction, key compromise, and delayed settlement. Kill switches must stop new orders without blocking safe withdrawal. Emergency exit must define which party can invoke it, affected assets, delay, cost, and fallback when a venue or chain is unavailable.

## Evidence and activation gate

Activation requires reviewed custody/mandate contracts, provider approvals, deterministic test vectors, replay/tamper/wrong-scope tests, real sandbox or testnet fills, reconciliation, load/failure tests, security review, legal classification, fee approval, support/dispute handling, and public release evidence. Until then, release state remains false.

## Change log

- 0.1.0-candidate: established truthful non-live boundary and candidate lifecycle.
