# Oracle Provider Licensing Strategy

**Document**: Provider Licensing Strategy for YNX Oracle Testnet Activation  
**Status**: Blocking testnet activation  
**Date**: 2026-07-23  
**Owner**: Foundation Legal + Oracle Engineering

## Problem Statement

The YNX Oracle requires **minimum 3 independent price data sources** to safely aggregate settlement-grade prices. All technically viable provider candidates are currently **blocked by licensing, legal rights, or market coverage limitations**:

- **Coinbase Exchange**: Terms of Use require "prior written consent" for benchmark/valuation/redistribution use
- **Kraken**: Entity/jurisdiction and benchmark/redistribution rights require written confirmation
- **Bitstamp**: Commercial users must execute a Data License Agreement; health probe failed
- **YNX-owned sources** (Exchange tape, DEX TWAP): Do not satisfy 3-source independence requirement

**Current state**: 0 of 3 sources active → Oracle cannot start in production mode → Testnet blocked

---

## Legal Requirements by Provider

### Coinbase Exchange

**Terms**: https://www.coinbase.com/legal/market_data

**Key Restrictions** (from Market Data Terms of Use):
> "You may not use Coinbase Exchange Market Data to create, offer, distribute, or otherwise make available any product or service that... constitutes or is used as a benchmark... generic or fair value pricing... derived valuation... without our prior written consent."

**Our Use Case**:
- ✅ We aggregate multi-source price observations
- ✅ We publish benchmark/index/mark prices for YNX products
- ✅ We redistribute aggregated values to YNX consumers
- ❌ Without written consent, this likely violates terms

**Required Action**:
1. Contact Coinbase Institutional or Market Data team
2. Disclose intended use: multi-source benchmark aggregation for testnet settlement
3. Request written consent or execute appropriate data license
4. Clarify: permitted markets, retention, redistribution scope, fees
5. Document entity, jurisdiction, term, renewal

**Timeline**: 2-4 weeks (legal negotiation + contract execution)

---

### Kraken

**Terms**: https://www.kraken.com/legal

**Key Unknowns**:
- Contracting entity varies by user jurisdiction
- Market data rights vary by product tier and entity
- Benchmark/redistribution/retention rights unclear without written agreement

**Our Use Case**:
- Same as Coinbase: multi-source aggregation, benchmark publication, redistribution

**Required Action**:
1. Identify applicable Kraken entity for YNX Foundation jurisdiction
2. Request market data rights clarification from Kraken legal/business team
3. Confirm: benchmark use, public redistribution, data retention, derived indexes
4. Execute written agreement if standard API access is insufficient
5. Document tier, markets, cost, limitations

**Timeline**: 2-4 weeks

---

### Bitstamp

**Terms**: https://www.bitstamp.net/api/#commercial-use-of-bitstamps-exchange-data

**Key Requirement**:
> "If you are a commercial user... you will need to execute a Commercial Data License Agreement."

**Technical Issues**:
- Health probe timed out during bounded engineering test
- No successful connection evidence

**Required Action**:
1. Contact Bitstamp to execute Commercial Data License Agreement
2. Confirm: markets, use case, retention, fees, support
3. Resolve connectivity/endpoint issue (timeout during probe)
4. Run successful health and data contract tests
5. Document agreement, tier, SLA

**Timeline**: 2-4 weeks + technical troubleshooting

---

## Alternative Strategies

### Strategy A: Testnet-Appropriate Free/Open Providers

**Concept**: Use providers with explicit free/open data policies for testnet only

**Candidates to Investigate**:
- **CoinGecko** — Free tier for non-commercial/research; terms allow limited use
- **CryptoCompare** — Free tier available; review commercial/redistribution limits
- **CoinCap** — Open API; review terms for aggregation/redistribution
- **Blockchain.com** — Public price API; review terms
- **Messari** — Research-focused; may allow testnet use

**Pros**:
- Faster activation (no contract negotiation)
- Lower cost for testnet phase
- Demonstrates Oracle functionality

**Cons**:
- May not cover YNXT/YUSD_TEST (YNX-native testnet markets)
- Free tiers often have rate limits insufficient for production
- Must migrate to licensed providers before mainnet
- Quality/SLA may be lower than institutional feeds

**Action Items**:
1. Legal review of terms for each candidate
2. Confirm: free tier covers aggregation, benchmark publication, public redistribution
3. Verify technical health, rate limits, coverage
4. Establish "testnet-only, will migrate" disclosure
5. Plan mainnet migration to institutional providers

**Timeline**: 1-2 weeks (faster than full license negotiation)

---

### Strategy B: YNX-Owned Multi-Venue Approach

**Concept**: Deploy multiple independent YNX reporter services across different venues

**Architecture**:
- Reporter A: YNX Exchange trade tape (venue-owned, direct access)
- Reporter B: YNX DEX TWAP (on-chain, different data source)
- Reporter C: External reference (e.g., CoinGecko free tier for BTC/ETH/USDC proxy)

**Pros**:
- Unblocks immediate testnet activation
- Demonstrates multi-source aggregation
- YNX controls 2 of 3 sources

**Cons**:
- **Does not satisfy true 3-source independence** (2 sources are YNX-owned)
- Thin testnet markets make YNX Exchange/DEX unsafe as sole authority
- Proxy markets (BTC/ETH) don't directly price YNXT/YUSD_TEST
- Circuit breaker will frequently trip on divergence
- Not suitable for mainnet

**Action Items**:
1. Deploy independent reporter services for Exchange and DEX
2. Add external free-tier provider as 3rd source
3. Document limitation: "testnet demonstration only, not independent"
4. Set aggressive circuit breakers and staleness limits
5. Plan migration to fully independent providers

**Timeline**: 1 week (engineering lift only)

---

### Strategy C: Testnet Bootstrap Mode

**Concept**: Launch with explicit "limited sources" mode and progressive activation

**Phase 1 - Single Source**:
- Deploy with 1 provider (e.g., CoinGecko free tier)
- Oracle returns prices with `quality.status = "limited_sources"`
- `quality.circuitBreaker = true` (unsafe for settlement)
- Consumers **must reject** these values for any authoritative use
- Purpose: Demonstrate infrastructure, not provide settlement prices

**Phase 2 - Add Second Source**:
- Add YNX DEX TWAP or second free provider
- Still `limited_sources`, still `circuitBreaker = true`

**Phase 3 - Achieve 3 Sources**:
- Complete licensing for institutional provider
- Activate 3rd independent source
- Oracle transitions to `quality.status = "good"`
- Circuit breaker lifts (if divergence is acceptable)
- Consumers can now safely use values

**Pros**:
- Unblocks deployment and integration testing immediately
- Demonstrates Oracle fail-closed behavior
- Consumers can build adapters and test rejection logic
- Clear upgrade path

**Cons**:
- No real settlement prices until Phase 3
- Risk of consumer confusion ("Oracle is live but unusable")
- Requires clear communication and status UI

**Action Items**:
1. Update release record: `channel: "testnet-bootstrap-limited"`
2. Deploy with 1 source and explicit warnings
3. Document "demonstration only, not for settlement" everywhere
4. Add prominent UI warnings on Oracle Web console
5. Progressively activate sources as licenses obtained

**Timeline**: 1-3 days (immediate deployment with limitations)

---

## Market Coverage Strategy

### YNXT/YUSD_TEST Problem

**Issue**: External providers do not list YNX testnet-native assets

**Options**:

**Option 1 - Proxy via BTC/ETH**:
- Use BTC/USD, ETH/USD, USDC/USD from external providers
- Display as proxy reference only
- Do not claim these are YNXT/YUSD_TEST prices
- Testnet users understand limitation

**Option 2 - YNX-Owned Testnet Sources**:
- YNX Exchange YNXT/YUSD_TEST tape
- YNX DEX YNXT/YUSD_TEST TWAP
- Accept limited independence for testnet
- Plan full independence for mainnet

**Option 3 - Synthetic Testnet Market**:
- Deploy "reference price service" that publishes YNXT prices based on governance-approved formula
- Use as one of three sources
- Clearly document as synthetic/formula-driven
- Replace with real market data before mainnet

**Recommendation**: Option 2 (YNX-owned testnet sources) + external BTC/ETH proxy for demonstration, with explicit "testnet limitation" disclosure

---

## Recommended Path Forward

### Immediate (Week 1-2): Testnet Bootstrap

1. **Legal**: Quick review of CoinGecko/CryptoCompare/CoinCap free-tier terms
2. **Engineering**: Deploy Oracle with 1-2 free-tier providers + YNX DEX
3. **Release**: Mark as `testnet-bootstrap-limited`, `circuitBreaker = true`
4. **Communication**: Clear "demonstration only, not settlement-grade" messaging
5. **Integration**: Consumers can build adapters and test rejection logic

**Outcome**: Oracle infrastructure publicly visible and testable, but not settlement-ready

### Short-Term (Week 3-6): Institutional Provider Onboarding

1. **Legal**: Initiate Coinbase, Kraken, Bitstamp license negotiations in parallel
2. **Engineering**: Prepare production registry for institutional providers
3. **Operations**: Provision reporter infrastructure and key custody
4. **Testing**: Run live provider health and failover drills
5. **Upgrade**: Activate institutional providers as licenses execute

**Outcome**: Transition to settlement-grade 3+ source Oracle

### Medium-Term (Month 2-3): Mainnet Readiness

1. **Coverage**: Establish real YNXT market depth or governance-approved pricing
2. **Independence**: Document full independence analysis for all sources
3. **SLA**: Confirm provider SLAs, support paths, incident procedures
4. **Governance**: Establish provider weight, removal, appeal processes
5. **Release**: Update to `channel: mainnet-candidate`

---

## Cost Estimates

| Provider Type | Testnet Cost | Mainnet Cost (est.) |
|---------------|--------------|---------------------|
| Free tier (CoinGecko, etc.) | $0 | Not permitted |
| Institutional feed (Coinbase, Kraken) | $500-2000/month | $2000-10000/month |
| YNX-owned sources | Infrastructure only | Infrastructure only |
| Reporter operations | $500/month | $2000/month |
| **Total Testnet** | **$500-2500/month** | N/A |
| **Total Mainnet** | N/A | **$4000-12000/month** |

*Estimates based on typical institutional market data pricing; actual costs TBD during negotiation*

---

## Risk Mitigation

### Legal Risk
- **Mitigation**: Obtain written agreements before using institutional data
- **Fallback**: Use only free-tier providers with clear terms for testnet

### Coverage Risk
- **Mitigation**: Accept proxy markets (BTC/ETH) for testnet demonstration
- **Fallback**: YNX-owned sources + synthetic reference

### Quality Risk
- **Mitigation**: Aggressive circuit breakers and staleness limits
- **Fallback**: Explicit `limited_sources` status prevents unsafe use

### Timeline Risk
- **Mitigation**: Bootstrap with free providers immediately
- **Fallback**: Progressive activation as licenses obtained

---

## Decision Matrix

| Strategy | Speed | Cost | Independence | Testnet Suitable | Mainnet Suitable |
|----------|-------|------|--------------|------------------|------------------|
| A. Free/Open Providers | ⚡ Fast (1-2 weeks) | $ Low | ✅ Yes | ✅ Yes | ❌ No (must migrate) |
| B. YNX Multi-Venue | ⚡ Fast (1 week) | $ Low | ⚠️ Limited | ⚠️ Demo only | ❌ No |
| C. Bootstrap Mode | ⚡⚡ Immediate | $ Low | ⚠️ Progressive | ✅ Yes | ⚡ Becomes suitable |
| Institutional Only | 🐌 Slow (4-8 weeks) | $$$ High | ✅ Yes | ✅ Yes | ✅ Yes |

**Recommendation**: **Strategy C (Bootstrap Mode)** → upgrade to **Strategy A (Free Providers)** → migrate to **Institutional** for mainnet

---

## Action Items & Owners

### Foundation Legal
- [ ] Review free-tier provider terms (CoinGecko, CryptoCompare, CoinCap)
- [ ] Initiate Coinbase Market Data license negotiation
- [ ] Initiate Kraken data rights confirmation
- [ ] Initiate Bitstamp Commercial Data License

### Oracle Engineering (This Thread)
- [ ] Deploy testnet-bootstrap with 1 free provider
- [ ] Add YNX DEX TWAP as 2nd source
- [ ] Update release record with `testnet-bootstrap-limited` channel
- [ ] Add UI warnings for limited sources / circuit breaker state
- [ ] Document proxy market limitations

### Foundation Operations
- [ ] Provision reporter infrastructure
- [ ] Generate and secure Ed25519 reporter keypairs
- [ ] Set up provider health monitoring
- [ ] Establish incident/on-call procedures

---

## Success Criteria

### Testnet Activation (Immediate)
- ✅ Oracle deployed with 1-3 sources (free tier + YNX-owned)
- ✅ Public API responding with explicit `limited_sources` status
- ✅ Oracle Web console shows provider status and warnings
- ✅ Consumers can test integration with bootstrap prices

### Settlement-Grade (4-8 weeks)
- ✅ ≥3 independent providers with executed licenses
- ✅ Confirmed YNXT coverage or approved proxy methodology
- ✅ `quality.status = "good"`, `circuitBreaker = false`
- ✅ Release record: `providerCountActive ≥ 3`, `channel: testnet`

---

## Conclusion

The Oracle licensing blocker can be resolved through a **phased activation approach**:

1. **Now**: Deploy with free providers in bootstrap mode (limited sources, circuit breaker active)
2. **Weeks 3-6**: Upgrade to institutional providers as licenses execute
3. **Mainnet**: Full independent 3+ source operation with proper licenses

This approach **unblocks testnet activation immediately** while establishing a clear path to settlement-grade operation. The key is maintaining honest quality reporting and failing closed until all licensing and independence requirements are met.

**Recommended immediate action**: Legal review of CoinGecko + CryptoCompare terms, followed by bootstrap deployment with explicit limitations.
