# Oracle & Market Data Integration Handoff

Namespace: `oracle`

## Authority

YNX Oracle & Market Data is the sole owner of canonical price and market-data facts. Consumer products must not maintain a conflicting definition of asset, market, timestamp, price type, staleness, quality, correction state, or lineage.

**Frozen Oracle source commit:** `8f4310988a6641c5b023497c74e901ff508771fe`
**Schema:** `ynx.oracle.v1`  
**Aggregation policy:** `weighted-median-mad-v1`  
**Derivatives policy:** `index-funding-mark-v1`  
**Normalizer:** `observation-normalizer-v1`  
**Store:** version 3

## Frozen runtime boundary

Provider adapters may submit signed `spot_price`, `premium_reference`, `basis_reference`, FX, stablecoin, structured market-data, DEX pool/TWAP, rate-candidate, and provider-status observations only when the provider registry explicitly covers the market, endpoint, and API version.

Providers may not submit `index_price`, `mark_price`, or `funding_reference`. Oracle derives those outputs from safe components, records the exact policy and component lineage, and fails closed on insufficient sources, stale data, divergence, clamp activation, pause, or unavailable inputs.

Exchange-specific public reads are:

- `GET /v1/index?market={market}`
- `GET /v1/funding?market={market}`
- `GET /v1/mark?market={market}`

The generic versioned price interface remains `GET /v1/prices?market={market}&type={type}`. Public operational interfaces include `/health`, `/version`, `/v1/providers`, `/v1/markets`, `/v1/status`, `/v1/history`, `/v1/corrections`, `/v1/replay`, and `/v1/market-data`.

## Consumer gate

Every consumer must validate schema, requested market and type, source, policy version, `asOf`, confidence, coverage, stale state, quality status, circuit breaker, explicit failure, observation hashes, and lineage hash. Index, funding, and mark consumers must additionally validate the derivative method, derivative policy, component types, component lineage hashes, and `clamped=false`.

Consumers must reject degraded, divergent, partial, limited-source, circuit-breaker, last-good-stale, emergency-pause, paused, and unavailable values. A last-good value is not fresh data and must never be used for liquidation, bridge release, mint/burn authority, or reserve assurance.

## Auth and admission

Public market-data reads may be anonymous and rate-limited. Internal observation ingestion requires canonical network/service admission and a registered Ed25519 reporter signature. Reporter identity is not Wallet identity, and a reporter signature does not replace Product Session or Gateway policy where those are required. Browser origins are not granted CORS access to internal ingestion.

Consensus code must not perform HTTP reads. Chain Core must consume a pre-validated, versioned Oracle record through a deterministic system-module or precompile integration.

## Migration conflict

The previous observation contract allowed providers to publish index, mark, and funding values. That protocol conflicts with Oracle ownership and is now rejected by runtime and schema. Provider adapters must migrate to spot, premium, and basis inputs; Exchange consumers must migrate to the derived interfaces. The repository does not preserve two authoritative protocols. `29 Integration` must freeze the single accepted version and merge order.

## Evidence and acceptance

Local Oracle race tests, vet, Web tests, real-Chrome accessibility, TypeScript SDK tests, deterministic release integrity, dependency audit and immutable Actions-pin checks pass against the source commit. After generating pinned contract selector metadata and restoring the Resource Market authority paths inherited from current `main`, the full repository test suite also passes.

Central integration, staging, public deployment, Explorer proof, Monitor alerts, provider activation, and consumer acceptance remain false until direct evidence is returned. The authoritative machine-readable files are:

- `release/integration/oracle-market-data-contract.json`
- `integration/oracle/v1/consumer-handoff.json`
- `docs/integration/ORACLE_CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/ORACLE_DEPENDENCY_ACCEPTANCE.md`
- `docs/integration/ORACLE_PROTOCOL_CONFLICT_REPORT.md`
