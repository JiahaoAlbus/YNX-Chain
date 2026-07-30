# Oracle Protocol Conflict Report

## Conflict

The previous `ynx.oracle.v1` provider-observation contract admitted `index_price`, `mark_price`, and `funding_reference` as if they were direct provider observations. That definition conflicts with the Oracle ownership boundary because these values must be derived from versioned, independently sourced components and must carry explicit derivation lineage.

A provider-published mark or index could silently become a single-venue liquidation input. A provider-published funding value could bypass the funding window, premium/basis calculation, governance clamp, and circuit breaker. Maintaining both protocols would create two incompatible sources of truth.

## Canonical resolution implemented

Frozen Oracle source commit `7ba44cfbe66455884ac6c2ea8525e9738b7f1396` enforces the following:

1. Providers may submit `spot_price`, `premium_reference`, and `basis_reference` only when their registry entry covers the exact market, endpoint, and API version.
2. Providers cannot submit `index_price`, `mark_price`, or `funding_reference`.
3. Oracle derives Index from the safe multi-source Spot aggregate.
4. Oracle derives Funding Reference from safe Premium and Basis aggregates under `index-funding-mark-v1`, with an eight-hour window declaration and a 5,000 PPM governance clamp.
5. Oracle derives Mark from Index and Funding Reference; Last Trade is not a liquidation price input.
6. Derived values include method, policy version, component types, component lineage hashes, raw adjustment, applied adjustment, clamp, and clamp state.
7. Stale, divergent, clamped, source-limited, paused, or unavailable components fail closed.

## Required migration

### Provider adapters

Stop sending `index_price`, `mark_price`, or `funding_reference`. Emit the permitted direct observations with exact registry-bound source metadata. Adapter contract tests must verify that the old types are rejected.

### Exchange consumers

Consume `GET /v1/index`, `GET /v1/funding`, and `GET /v1/mark`, or the generic `/v1/prices` interface with an exact requested type. Validate `derivation`, `version`, `asOf`, quality, source count, confidence, coverage, lineage, and `clamped=false`.

### Chain Core and other consumers

Do not call HTTP during consensus and do not recalculate a competing index. Commit the accepted Oracle record through a deterministic integration contract. Other consumers must use the same canonical record and quality semantics.

## Compatibility decision

Long-term dual-protocol compatibility is rejected. Legacy provider-derived values must remain invalid after migration. Historical files may be read only through explicit migration tooling and must never regain authoritative publication status.

## Freeze request to 29 Integration

`29 Integration` must freeze:

- `ynx.oracle.v1` provider-input enum after this migration;
- `weighted-median-mad-v1` aggregation policy;
- `index-funding-mark-v1` derivative policy;
- the derived endpoints and fields;
- the consumer fail-closed statuses;
- the cross-product test vectors and merge order.

Until that acceptance is returned, `integratedCentral` remains false.
