# YNX Bridge, Oracle, and Data Fabric

| Metadata | Value |
| --- | --- |
| Version | 0.1.0-candidate |
| Effective date | 2026-07-22 |
| Accepted central source | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Bridge candidate reviewed | `fba6b71` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |
| Review status | Bridge local-candidate disclosure and Oracle/Data gap specification |

## Direct answer

YNX has a fail-closed local Bridge coordinator candidate, but no live Bridge. The
coordinator records source events, relayer attestations, lifecycle, safety state,
operator-observed reconciliation, audit and recovery. External submission and
destination mint/release execution remain disabled.

No accepted general Oracle or Data Fabric implementation is recovered in the
central source. Market prices, provider responses, reconciliation references and
derived indexes must therefore remain explicitly non-authoritative unless an
approved versioned YNX protocol establishes their authority.

## 1. Bridge trust boundary

The local coordinator can:

- persist transfer intents and exact idempotency;
- reject reuse of a source event;
- enforce route, amount, finality and outstanding-exposure bounds;
- verify allowlisted Ed25519 relayer attestations with threshold at least two;
- persist pause/resume state;
- record source, proof, destination, failure, retry, recovery and dispute phases;
- publish coordinator-observed transparency and reconciliation records; and
- maintain a hash-chained audit trail with versioned state.

It cannot:

- submit a source- or destination-chain transaction;
- lock, burn, mint or release an external asset;
- freeze or seize native YNXT;
- prove an operator evidence reference is authentic;
- establish bridge liquidity, reserves, issuer support or provider approval;
- hold production relayer or custody keys; or
- prove public deployment or availability.

## 2. Lifecycle

| Phase | Meaning | Authority |
| --- | --- | --- |
| `source_submitted` | Coordinator accepted bounded source-event input | Coordinator state only |
| `source_accepted` | Source event passed configured acceptance checks | Coordinator interpretation |
| `source_finalized` | Configured source finality condition recorded | Requires source evidence; not destination execution |
| `proof_attestation` | Threshold relayer attestations bind the event | Coordinator-verified signer set |
| `destination_mint_release` | Operator-observed destination action reference recorded | Reference only; coordinator does not execute it |
| `destination_confirmed` | Destination outcome recorded with reason/evidence | Operator-observed until independently verified |
| `failed` | A bounded failure is recorded | Explicit failure state |
| `refund_recovery` | Recovery/refund state is recorded | Does not itself move funds |
| `dispute` | Dispute is open or recorded | Requires evidence and resolution authority |
| `retry` | A controlled retry is recorded | Must preserve idempotency and limits |

Quote and user review occur before coordinator submission and belong to the
canonical Wallet approval flow. The coordinator must not synthesize user consent.

## 3. Canonical and represented assets

A route must identify origin chain, destination chain, canonical asset,
represented asset if any, contract or native identifier, decimals, finality,
mint/burn or lock/release authority, rate and outstanding limits, pause authority,
and recovery.

Represented assets are not the same asset instance as the origin asset. A wallet,
exchange or DEX must display route, issuer/bridge authority, backing model,
redemption path, fees, delay, liquidity, depeg, smart-contract, relayer, custody,
governance and emergency risks.

No YNXT bridge representation is approved by this document.

## 4. Reconciliation

The Bridge candidate can record locked, burned, minted, released, outstanding
supply, reserve backing, difference and balanced state. The current truth labels
are always:

- source: `operator-submitted-evidence`;
- verification: `reference-recorded-not-independently-verified`.

An unbalanced report remains visibly unbalanced. Editing or replacing state to
hide a difference is prohibited. A balanced operator report is not proof of
reserves, contract state, custody, liquidity or solvency.

Independent reconciliation requires direct source and destination state,
canonical event proofs, contract authority, pending-message accounting,
reorg/finality treatment, liabilities, asset control and observation time.

## 5. Relayers and custody

Production readiness requires:

- separated relayer and administrative keys;
- HSM or equivalent custody and threshold policy;
- on-host key generation, rotation, revocation and compromise response;
- independent operators or explicit concentration disclosure;
- signer allowlist versioning and timelock;
- finality and replay protection;
- rate, amount and outstanding exposure limits;
- incident pause, recovery and emergency exit; and
- public signer/route evidence without private material.

Relayer quorum is not validator quorum, asset reserve or user custody.

## 6. Oracle authority classes

Every Oracle or market-data record must use one authority class:

| Class | Meaning |
| --- | --- |
| YNX protocol state | Deterministically committed by an approved consensus mechanism |
| Approved signed observation | Signed by an allowlisted provider under a versioned feed policy |
| Third-party API | Provider response within its licensed scope; not YNX authority |
| Derived estimate | Calculation from identified inputs and method |
| Cache | Previously observed value with age and invalidation policy |
| User input | Supplied by a user and not independently verified |
| AI inference | Model output; never authoritative financial or chain state |

Every record includes `source`, `asOf`, `version`, `coverage` or `confidence` when
meaningful, and an explicit failure/stale/unavailable state.

## 7. Oracle feed requirements

A feed specification must define:

- asset pair and base/quote units;
- provider(s), licenses, terms and jurisdictions;
- authentication and key custody;
- observation, aggregation and publication cadence;
- decimals, rounding and overflow behavior;
- staleness, deviation, confidence and circuit-breaker thresholds;
- market-hours and zero-liquidity behavior;
- duplicate, outlier, missing and conflicting observations;
- manipulation, flash-loan and venue-concentration threats;
- fail-closed consumers and fallback rules;
- retention, data rights and redistribution permissions; and
- version, governance, migration and rollback.

No price, NAV, reserve, collateral, liquidation, exchange rate, APY or PnL claim
may use a feed without those fields and consumer-specific risk review.

## 8. Data Fabric record contract

The Data Fabric is a candidate cross-product contract, not a recovered central
service. A versioned record should contain:

```json
{
  "schemaVersion": "1.0.0",
  "recordType": "qualified-name",
  "subject": "canonical-subject-id",
  "value": {},
  "authorityClass": "third-party-api",
  "source": "identified-source",
  "asOf": "RFC3339 timestamp",
  "receivedAt": "RFC3339 timestamp",
  "version": "source-or-policy-version",
  "coverage": {"status": "complete-or-bounded"},
  "confidence": null,
  "failure": null,
  "provenance": [],
  "integrity": {"algorithm": "sha256", "digest": "hex"}
}
```

This example defines fields, not a live response. Production schemas must reject
unknown or missing authority fields and must version breaking changes.

## 9. Consumer rules

- Wallet identity, balance, nonce and permission come from canonical Wallet and
  authoritative chain/Gateway state, not a market-data provider.
- Exchange order, custody and settlement state come from the accepted venue or
  chain adapter, not a chart cache.
- DEX reserves and execution use exact approved contract state; a quoted route is
  not a receipt.
- Quant may consume market data for analysis but cannot exceed the signed mandate
  or infer asset custody.
- Stablecoin reserve and redemption require issuer/custodian evidence, not only a
  price feed.
- Trust cases and legal decisions require defined authority and appeal; AI scores
  or third-party labels are inputs only.

## 10. Failure behavior

Provider outage, stale data, signature failure, wrong chain, reorg, reconciliation
difference, limit saturation, route pause, index lag and conflicting sources are
distinct failures. Consumers must show the failure and block unsafe actions. They
must not substitute zero, last price, cached success or hard-coded health without
an explicit approved fallback and visible age.

## 11. Migration, backup and recovery

Bridge persisted state schema v2 verifies legacy v1 integrity before converting
known statuses. Unknown status or tampered integrity fails closed. Rollback after
v2 persistence requires the pre-migration v1 binary and state backup together;
lossy downgrade is prohibited.

Oracle/Data schemas similarly require versioned migration, old-client behavior,
replay safety, backup, isolated restore, retention, export/delete where applicable,
and source-revocation handling.

## 12. Observability

Bridge health and metrics expose build, integrity, route/relayer counts, pause,
outstanding exposure and explicit false values for live Bridge and external
submission. Alerts must separate pause, limit saturation, reconciliation
difference, stale reconciliation, persistence failure and API outage.

Oracle/Data observability requires per-source latency, freshness, coverage,
signature failure, deviation, fallback, rate-limit and consumer rejection metrics
without leaking credentials, user payloads or provider-restricted data.

## 13. Capacity and unit economics

No production capacity or Bridge economics are claimed. Required measurements
include p50/p95/p99 mutation/read/persistence/provider/finality latency,
throughput, concurrent clients, queue depth, state growth, cold start, error rate,
rate limits and reconciliation age.

Costs separate source/destination gas, provider/attestation, relayer/HSM, RPC,
indexing, compute, storage, monitoring, support, disputes, audits and risk pools.
User-visible fees require pre-approval and receipt reconciliation. Hidden spread
and undisclosed mint/burn economics are prohibited.

## 14. Current release-state truth

| Capability | implementedLocal | testedLocal | integratedCentral | deployedPublic |
| --- | --- | --- | --- | --- |
| Bridge coordinator lifecycle and safety | true on reviewed candidate | true on candidate | false | false |
| Transparency and operator reconciliation | true on reviewed candidate | true on candidate | false | false |
| External-chain submission | false | false | false | false |
| Destination mint/release execution | false | false | false | false |
| Funded route and liquidity | false | false | false | false |
| General Oracle service | false | false | false | false |
| General Data Fabric service | false | false | false | false |

## 15. Evidence and adoption gates

Bridge public activation requires approved route and provider, source/destination
adapters, contract authority, custody, limits, funded Testnet route, independent
security/legal review, migration/restore/rollback drills, public transactions and
reconciliation.

Oracle/Data activation requires provider register, licenses/terms/data rights,
signed versioned records, manipulation and outage tests, consumer fail-closed
vectors, observability, retention and public source/freshness evidence.

## Change log

- 0.1.0-candidate (2026-07-22): Consolidated Bridge lifecycle, reconciliation,
  relayer and asset boundaries with Oracle authority, feed requirements, Data
  Fabric record contract, consumer rules, failures, operations and release truth.
