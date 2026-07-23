# YNX Oracle & Market Data — Testnet Activation Status

**Product ID**: ynx-oracle-market-data  
**Version**: 0.1.0-testnet  
**Branch**: codex/final-oracle-market-data  
**Last Commit**: df817b6 (docs: bind release evidence commit)  
**Status Date**: 2026-07-23

## Executive Summary

The unified YNX Oracle & Market Data infrastructure is **fully implemented and locally tested** but **not yet activated for public testnet** due to three blocking dependencies:

1. **No active price providers** — Legal/licensing approval required for Coinbase, Kraken, Bitstamp; YNXT/YUSD_TEST market coverage gap
2. **No public API deployment** — Oracle daemon requires operator-supplied registry and HMAC key (intentional fail-closed)
3. **No central integration** — Chain/Exchange/DEX/Quant/Finance consumers await owner acceptance and integration

All core engineering work is complete and verified. The product cannot proceed to public testnet without resolving the three blockers above.

---

## Implementation State ✅

### Core Infrastructure (Implemented & Tested)

| Component | State | Evidence |
|-----------|-------|----------|
| **Signed observations** | ✅ Implemented & tested | Ed25519 validation, replay/tamper rejection, nonce domain, sequence enforcement |
| **Provider registry** | ✅ Implemented & tested | Strict schema with coverage, license, terms, storage rights, auth, limits, region, cost, fallback |
| **Aggregation algorithms** | ✅ Implemented & tested | Liquidity-weighted median, MAD outlier rejection, staleness/future rejection, divergence, circuit breaker |
| **3-source minimum policy** | ✅ Implemented & tested | Configurable policy, fail-closed on insufficient sources, explicit limitation reporting |
| **Typed market data** | ✅ Implemented & tested | Strict OHLCV, trades, CLOB books, DEX pools, provider health; prohibited from scalar aggregation |
| **Data integrity store** | ✅ Implemented & tested | HMAC-protected v3 store, raw/normalized/aggregate events, corrections, lineage, replay |
| **Public HTTP API** | ✅ Implemented & tested | `/health`, `/version`, `/prices`, `/v1/market-data`, `/v1/providers`, `/v1/replay` |
| **Consumer SDK (Go)** | ✅ Implemented & tested | Schema/version/quality validation, stale/breaker/source/confidence rejection |
| **Web console (PWA)** | ✅ Implemented & tested | 12 languages, RTL, themes, reduced motion, SSR, production build passes |
| **Container image** | ✅ Implemented & tested | Non-root, digest-pinned, Go 1.25.12, read-only, Trivy scan clean, DAST passes |
| **Security gates** | ✅ Implemented & tested | Threat model, vulnerability scans, 3 SBOMs, secret scan, container DAST |

**Test Results**: All oracle tests pass with race detection
```
ok  	github.com/JiahaoAlbus/YNX-Chain/internal/oracle	27.606s
ok  	github.com/JiahaoAlbus/YNX-Chain/internal/oracle/providers	2.030s
ok  	github.com/JiahaoAlbus/YNX-Chain/sdk/oracle/go	2.536s
```

---

## Critical Blockers 🚫

### 1. Provider Activation (Legal & Coverage)

**Status**: 0 of 3 required sources active

**Provider Candidates**:

| Provider | Technical State | Blocker |
|----------|----------------|---------|
| Coinbase Exchange | ✅ Adapter tested | ❌ Market Data Terms require prior written consent for benchmark/valuation/redistribution use |
| Kraken | ✅ Adapter tested | ❌ Applicable entity/jurisdiction and benchmark/redistribution/retention rights not confirmed |
| Bitstamp | ✅ Adapter contract tested | ❌ Commercial Data License Agreement required; health probe timed out |
| YNX Exchange tape | ✅ Source candidate | ❌ Does not satisfy 3-source independence or turn thin testnet market into safe settlement price |
| DEX pool/TWAP | ✅ Source candidate | ❌ Same limitation as Exchange tape |

**Required Actions**:
- [ ] Execute commercial data license agreements with approved providers
- [ ] Confirm market-data rights for benchmark, valuation, redistribution, and retention
- [ ] Establish independent reporter identities with Ed25519 signing keys in approved custody
- [ ] Register at least 3 independent providers with confirmed YNXT/YUSD_TEST or BTC/ETH/USDC coverage
- [ ] Document jurisdiction, entity, terms version, cost, and support path
- [ ] Generate versioned production registry JSON
- [ ] Run live provider health and failover drills

**Current Registry**: `config/oracle/provider-candidates.json` — intentionally NOT a production registry; all candidates marked `legal_approval_required` or `license_and_health_required`

**Fail-Closed Behavior**: Oracle daemon refuses to start without operator-supplied active registry

---

### 2. Public Deployment

**Status**: Private deployment only; public API unavailable

**Current State**:
- Oracle Web deployed at `https://ynx-oracle-control.jeohuang.chatgpt.site/oracle`
- Access: **owner_only** (HTTP 401 for unauthenticated requests)
- Oracle daemon (ynx-oracled): Not publicly deployed
- Container built locally: `tmp/oracle-release-a/ynx-oracled`, `tmp/oracle-release-b/ynx-oracled`
- No hosted/signed/store artifacts

**Required Actions**:
- [ ] Provision production infrastructure (compute, network, monitoring)
- [ ] Generate and secure HMAC state integrity key (`YNX_ORACLE_STATE_HMAC_KEY_HEX`)
- [ ] Deploy ynx-oracled with approved provider registry
- [ ] Establish public HTTPS endpoint with proper TLS
- [ ] Configure CORS for Oracle Web origin
- [ ] Set up structured logging, metrics export, health monitoring
- [ ] Integrate with central Gateway rate limits and service admission
- [ ] Document public endpoint URLs in release record
- [ ] Run remote smoke tests and load baseline
- [ ] Make Oracle Web publicly accessible (remove 401 gate)

**Current Release Record**: `release/product-release.json`
```json
{
  "productId": "ynx-oracle-market-data",
  "channel": "testnet-candidate",
  "version": "0.1.0-testnet",
  "providerCountActive": 0,
  "requiredProviderCount": 3,
  "sourceLimitation": "No approved provider covers YNXT/YUSD_TEST...",
  "released": false
}
```

---

### 3. Central Integration

**Status**: Handoff contracts ready; owner acceptance pending

**Consumer Contracts Delivered**:
- ✅ `integration/oracle/v1/price.schema.json` — Price response schema
- ✅ `integration/oracle/v1/observation.schema.json` — Signed observation schema
- ✅ `integration/oracle/v1/market-data-feed.schema.json` — Structured data feed schema
- ✅ `integration/oracle/v1/consumer-handoff.json` — Authority boundaries and acceptance criteria
- ✅ `integration/oracle/v1/consumer-test-vectors.json` — Accept/reject test vectors
- ✅ `sdk/oracle/go/client.go` — Go consumer SDK
- ✅ `docs/integration/oracle-consumers.json` — Consumer interface contracts

**Consumers Awaiting Integration**:

| Consumer | Required Integration | Owner Action |
|----------|---------------------|--------------|
| Chain Core | System module/precompile for consensus | Implement deterministic state transition; return acceptance vector |
| Exchange | Index/mark/funding adapter | Replace venue-local price facts; return liquidation drill evidence |
| DEX | Pool observation publisher + TWAP consumer | Confirm reorg and TWAP vectors |
| Quant | Live/historical feed adapter | Preserve raw trades; return source lineage display |
| Stablecoin | Price/reserve/depeg signal consumer | Separate mint/burn authority; return depeg vector |
| Finance & Pay | Quote/display adapter with expiry | Bind quote expiry to asOf; return fee disclosure review |
| Explorer & Monitor | Lineage/correction views + alerts | Return public record URLs and alert timestamps |
| Gateway/Wallet/Auth | Public routing + display | Return gateway route test and auth boundary review |
| Bridge | Risk-limit input only | Return governance limit vector and breaker drill |

**Integration Rule**: Each owner must return named acceptance evidence against exact source commit. File presence ≠ `integratedCentral=true`

**Current State**: All handoff artifacts exist; zero acceptance evidence received

---

## Data Types Supported

**Scalar (aggregatable)**:
- spot_price, index_price, mark_price, funding_reference
- fx, stablecoin_price, stablecoin_reserve_ratio, stablecoin_depeg
- dex_twap, interest_rate_candidate

**Structured (feed-only, non-aggregatable)**:
- ohlcv (candles), trades (trade batches)
- clob_order_book (order book snapshots)
- dex_pool_state (on-chain pool reserves with block hash)
- provider_status (health/latency)
- data_correction, historical_replay

---

## Security & Quality Features

### Aggregation Security
- Weighted median with liquidity-aware weighting
- MAD outlier rejection (6× median absolute deviation)
- Staleness rejection (30s default), future-date rejection (2s skew)
- 3-source circuit breaker, divergence monitoring (50k PPM max)
- Confidence/coverage scoring (parts-per-million)

### Data Integrity
- Ed25519 signed observations with reporter identity
- HMAC-protected state store with event chain
- SHA-256 lineage hashing, correction audit trail
- Historical replay with as-of time travel

### Operational Security
- Fail-closed by default (no registry = degraded)
- Last-good with explicit stale flag
- Circuit breaker prevents unsafe values
- Source limitation reporting, emergency pause/resume

---

## Activation Pathway

### Phase 1: Provider Onboarding (Blocking)
1. Engage legal for provider data license negotiations
2. Execute commercial agreements with 3+ providers
3. Confirm YNXT/YUSD_TEST coverage or proxy markets
4. Generate Ed25519 reporter keypairs (never in git/chat)
5. Run provider contract tests against live endpoints
6. Document independence analysis
7. Create production provider registry JSON
8. Run provider failover drills

**Owner**: Foundation legal + operations + this thread

### Phase 2: Infrastructure Deployment (Blocking)
1. Provision production compute
2. Generate and secure HMAC state key
3. Deploy ynx-oracled with production registry
4. Establish HTTPS endpoint with TLS
5. Configure Gateway routing and rate limits
6. Set up logging, metrics, alerting
7. Run remote smoke tests
8. Make Oracle Web public
9. Update release record

**Owner**: Platform/DevOps + this thread

### Phase 3: Central Integration (Blocking)
1. Deliver handoff contracts to consumer owners
2. Owners implement adapters, return evidence
3. Run integration vectors
4. Conduct failover drills
5. Document integration in release record

**Owner**: Each product owner (Chain/Exchange/DEX/Quant/Finance/etc.)

### Phase 4: Public Testnet Release
1. Verify all phases complete
2. Run full preflight
3. Update release: `released: true`, `channel: testnet`
4. Publish release notes
5. Announce public endpoints
6. Monitor and establish on-call

**Owner**: Foundation + this thread

---

## Next Actions

### Immediate (This Thread)
1. Create provider licensing strategy document
2. Create deployment runbook with specific commands
3. Prepare consumer integration packets for delivery

### Owner Dependencies
- **Foundation Legal**: Execute provider data license agreements
- **Foundation Ops**: Provision infrastructure, deploy Oracle daemon
- **Chain Core Owner**: Implement consensus module, return acceptance vector
- **Exchange Owner**: Implement index/mark/funding adapter, return drill evidence
- **DEX Owner**: Implement pool publisher + TWAP consumer, return vectors
- **Other Product Owners**: Implement adapters per handoff contracts, return evidence

### Success Criteria
- ≥3 active independent providers with confirmed legal rights and YNXT coverage
- Public HTTPS Oracle API endpoint responding to health/version/prices queries
- ≥1 central consumer integrated with acceptance evidence
- Oracle Web publicly accessible with live endpoint queries working
- Release record updated: `providerCountActive ≥ 3`, `released: true`

---

## Conclusion

The YNX Oracle & Market Data infrastructure represents a **complete, production-ready implementation** of a secure, multi-source price oracle with robust aggregation, integrity controls, and consumer contracts. All engineering work is finished and verified.

**The product cannot activate** until:
1. Provider licenses are executed and active registry is created
2. Public infrastructure is deployed with production secrets
3. At least one central consumer integrates and returns acceptance evidence

This is an **externally-blocked activation**, not an incomplete implementation. The engineering package is ready for handoff to legal, operations, and product owners.

**Status**: `implementedLocal=true`, `testedLocal=true`, `installedLocal=true`; all deployment/integration states `false` pending blocker resolution.
