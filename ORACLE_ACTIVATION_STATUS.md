# YNX Oracle & Market Data — Testnet Activation Status

**Product ID**: ynx-oracle-market-data  
**Version**: 0.1.0-testnet  
**Branch**: codex/final-oracle-market-data  
**Last Commit**: 1d17e52 (feat: fail-closed consumer CLI; follows TypeScript SDK 6e811f7)  
**Status Date**: 2026-07-27

## Executive Summary

The unified YNX Oracle & Market Data core runtime is **implemented and locally tested**, and a **limited-source public Testnet control plane** is deployed. It intentionally publishes no authoritative prices because the source gate is 0/3. Final Founder-grade delivery remains active rather than complete because:

1. **No active approved price providers** — legal/licensing approval, independent reporter custody, and YNXT/YUSD_TEST coverage remain external blockers.
2. **No central integration acceptance** — Chain/Exchange/DEX/Quant/Finance and other consumers have not returned exact-commit acceptance evidence.
3. **The Oracle Web is not public and downloadable artifacts are not hosted or production-signed**.
4. **Autonomous release work remains** — current-commit artifact provenance, package evidence, accessibility audit, and evidence synchronization are still in progress.

The public API deployment is real but deliberately degraded and fail-closed. It is not an authoritative price release, and `released` remains `false`.

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

**Status**: Limited-source public API deployed; authoritative prices, public Web, and hosted artifacts remain unavailable

**Current State**:
- Public API: `https://oracle-testnet.43.153.202.237.sslip.io`
- API source mode: **limited**, with degraded HTTP 503 health at 0/3 sources and fail-closed price responses
- Oracle Web: `https://ynx-oracle-control.jeohuang.chatgpt.site/oracle`
- Oracle Web access: **owner_only** (HTTP 401 for unauthenticated requests)
- Public deployment source commit: `f71d5ca5c2ede28477fbadff36701a9f040e311f`
- Current candidate source commit: `1d17e520186a500f5c9ab04ee88769637d88fc59`
- No hosted, production-signed, or store artifacts

**Required Actions**:
- [x] Establish limited-source public HTTPS endpoint with trusted TLS
- [x] Verify remote `/version`, degraded `/health`, provider status, and fail-closed price behavior
- [ ] Activate an approved provider registry and secure reporter signers
- [ ] Deploy the current candidate commit after release/provenance gates pass
- [ ] Configure and verify Oracle Web CORS against the public API
- [ ] Integrate central Gateway rate limits and service admission
- [ ] Run current-commit load, failover, restore, and rollback baselines
- [ ] Make Oracle Web publicly accessible
- [ ] Host immutable server, CLI, and SDK artifacts with hashes and provenance

**Current Release Record**: `release/oracle/product-release.json`
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

### Immediate autonomous work
1. Package current-commit `ynx-oracled`, `ynx-oracle-cli`, Go SDK, and TypeScript SDK outputs deterministically.
2. Generate current-commit SHA-256, byte size, SBOM, provenance, minimum-runtime, install, and cold-start evidence.
3. Run direct keyboard, screen-reader, Arabic RTL, large-text, reduced-motion, light/dark, and 390px browser audits.
4. Synchronize the coverage matrix, feature evidence, release notes, and Release Record after each verified slice.

### Owner dependencies
- **Foundation Legal**: Execute provider data-license agreements and confirm benchmark, valuation, redistribution, and retention rights.
- **Foundation Operations**: Provide approved provider access, secure reporter/HMAC custody, and deployment authority without exposing secrets in chat.
- **Chain Core Owner**: Implement the deterministic system module and return exact-commit acceptance vectors.
- **Exchange Owner**: Implement index/mark/funding consumption and return liquidation/failover evidence.
- **DEX Owner**: Implement pool publishing and TWAP consumption, including reorg vectors.
- **Other Product Owners**: Implement adapters and return exact-commit acceptance evidence.
- **Website/Security/Integration Owners**: Publish the public Web and immutable artifacts, approve release security, and freeze the shared protocol.

### Final success criteria
- At least three active independent providers with confirmed rights, coverage, health, and separately controlled reporter identities.
- Authoritative prices published only after source, freshness, divergence, failover, and manipulation gates pass.
- Central consumers integrated with exact-commit acceptance evidence.
- Oracle Web publicly accessible and bound to the live API with truthful degraded/failure states.
- Immutable server, CLI, and SDK artifacts hosted with hashes, SBOM, provenance, signing class, and cold-start evidence.
- Explorer/Monitor evidence, restore/load/failover drills, full preflight, clean worktree, and Local SHA = Remote SHA.
- Release record updated to `released: true` only after every applicable gate passes.

---

## Conclusion

The YNX Oracle & Market Data core is a substantial **locally tested Testnet candidate**, and its limited-source public control plane is real and publicly verifiable. It is deliberately degraded at 0/3 approved sources and does not publish authoritative prices.

The product is **not complete**. Autonomous artifact, accessibility, evidence, and current-commit release work remains, while provider activation, central consumer acceptance, public Web access, hosting/signing authority, and final security/integration approval require external owners.

**Status**: `implementedLocal=true`, `testedLocal=true`, `installedLocal=true`, `integratedCentral=false`, `deployedPublic=true` only for the limited-source control plane, `downloadHosted=false`, `productionSigned=false`, `storeReleased=false`, and `released=false`. The long-term goal remains `active`.
