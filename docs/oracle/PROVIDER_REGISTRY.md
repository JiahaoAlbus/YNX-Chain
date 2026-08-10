# Provider registry policy

`config/oracle/provider-candidates.json` records technical candidates and legal limitations. It is intentionally not a daemon-loadable production registry. Public accessibility of an API is not permission to build or redistribute an index, mark, valuation, or benchmark.

A candidate may become `active` only when all of the following direct evidence is attached to a versioned registry change:

1. Correct legal entity, jurisdiction, terms version, intended uses, storage/retention, derived-work, public display, redistribution, benchmark, and settlement rights.
2. Official endpoint/API version, market coverage, timestamp semantics, precision, authentication, rate limit, cost, region, and outage support path.
3. Independent reporter identity and Ed25519 public key; the private key remains in an approved signer and never enters source control or chat.
4. Live and sandbox contract tests, bounded failure behavior, clock synchronization, update frequency, duplicate/replay behavior, and outage evidence.
5. Independence analysis covering corporate entity, upstream venue, cloud/region, network path, software implementation, reporter operator, and signer custody.
6. Governance-approved weight, markets/types, staleness threshold, notice, appeal, emergency removal, fallback, and decommission plan.

## Current decision

- Coinbase Exchange: technically reachable, but its official market-data terms restrict the intended benchmark/valuation/redistribution use absent prior written consent. Inactive.
- Kraken: technically reachable, but applicable entity/jurisdiction and benchmark/redistribution/retention rights are not confirmed. Inactive.
- Bitstamp: adapter contract is locally tested; official documentation directs commercial users to obtain a data license, and the direct health probe timed out. Inactive.
- Exchange trade tape and DEX pool/TWAP: YNX-owned source candidates, but they do not by themselves satisfy three-source independence or turn a thin Testnet market into a safe settlement price.

No active registry file is shipped. The daemon consequently cannot start in a production-like mode until an operator supplies an approved registry and state-integrity key. This is intentional fail-closed behavior.
