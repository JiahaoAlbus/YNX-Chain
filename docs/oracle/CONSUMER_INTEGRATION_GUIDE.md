# Oracle Consumer Integration Guide

**Audience**: Chain Core, Exchange, DEX, Quant, Finance, Pay, Stablecoin, Explorer, Monitor, Bridge, Gateway, Wallet product owners  
**Purpose**: Integrate YNX Oracle Market Data into your product  
**Version**: 0.1.0-testnet  
**Date**: 2026-07-23

---

## Overview

The YNX Oracle provides **multi-source aggregated market data** with quality metrics, circuit breakers, and lineage tracking. This guide helps you integrate Oracle data into your product safely.

**Key Principle**: **HTTP 200 is not acceptance.** Your product must validate schema, quality, staleness, and circuit breaker state before using any Oracle value.

---

## Quick Start

### 1. Read the Handoff Contract

**File**: `integration/oracle/v1/consumer-handoff.json`

This file defines:
- Authority boundaries (what Oracle owns, what it doesn't)
- Required consumer checks
- Product-specific integration requirements
- Acceptance evidence you must return

### 2. Review Your Product's Requirements

Find your product in the `owners` array of `consumer-handoff.json`. Each owner has:
- `consume`: Data types your product needs
- `deliver`: What you must implement
- `mustReject`: Conditions your product must reject
- `acceptanceEvidence`: What you must return to prove integration

### 3. Use the Consumer SDK

**Go SDK**: `sdk/oracle/go/client.go`

```go
import "github.com/JiahaoAlbus/YNX-Chain/sdk/oracle/go"

// Create client
client := oraclego.NewClient("https://oracle-api.ynx-testnet.com", 10*time.Second)

// Get price with validation
price, err := client.GetPrice(context.Background(), "BTC/USD", "spot_price")
if err != nil {
    // Handle error: network, timeout, validation failure, unsafe quality
    return err
}

// price is validated and safe to use
fmt.Printf("BTC/USD: %d (scale: %d)\n", price.Value, price.Scale)
```

The SDK automatically rejects:
- Schema version mismatch
- Stale or future-dated values
- Circuit breaker active
- Insufficient sources
- Low confidence/coverage
- Invalid lineage hash

### 4. Implement Required Rejection Logic

Even with the SDK, your product must:
- Never use Oracle data during consensus (Chain Core)
- Never substitute Oracle for wallet identity, auth, balances, or permissions
- Never use structured feeds (OHLCV, trades, order book) as aggregated price
- Fail closed when quality is unsafe
- Log rejection events for audit

### 5. Return Acceptance Evidence

Once integrated and tested, return evidence to `docs/oracle/integration-evidence/[your-product].json`:

```json
{
  "product": "Exchange",
  "sourceCommit": "df817b6...",
  "acceptanceDate": "2026-07-23",
  "evidence": [
    {"type": "test_vector", "result": "pass", "description": "Index/mark/funding adapter rejects stale values"},
    {"type": "drill", "result": "pass", "description": "Liquidation breaker drill: halts on circuit breaker"},
    {"type": "code_review", "result": "pass", "description": "No hidden fallback to single venue price"}
  ]
}
```

---

## Integration by Product

### Chain Core

**Consume**: `spot_price`, `index_price`, `stablecoin_price`

**Deliver**: Deterministic system module that commits validated Oracle records to consensus state

**Architecture**:
```
Off-chain Oracle Reader Service
  ↓ (validated price record)
Governance-approved Module
  ↓ (deterministic state transition)
Chain Consensus
  ↓ (committed block)
Chain State (authoritative price)
```

**Must Reject**:
- HTTP calls during consensus (non-deterministic)
- Stale or circuit breaker values
- Fewer than 3 sources
- Unknown policy version

**Required Evidence**:
- [ ] State transition test vector
- [ ] Upgrade/rollback height documentation
- [ ] Explorer record showing committed Oracle values

**Sample Integration**:
```go
// OFF-CHAIN: Oracle reader service
func (s *OracleReader) FetchAndValidate() (*OracleRecord, error) {
    price, err := s.client.GetPrice(ctx, "YNXT/YUSD", "spot_price")
    if err != nil || price.Quality.CircuitBreaker || price.Quality.SourceCount < 3 {
        return nil, errors.New("unsafe oracle state")
    }
    // Convert to deterministic record
    return &OracleRecord{
        Value: price.Value, Scale: price.Scale,
        AsOf: price.AsOf, PolicyVersion: price.Version,
        LineageHash: price.LineageHash,
    }, nil
}

// ON-CHAIN: Consensus module (deterministic, no HTTP)
func (m *OracleModule) ApplyRecord(record OracleRecord) error {
    // Validate record structure (no network calls)
    if err := record.Validate(); err != nil {
        return err
    }
    // Commit to state
    return m.state.SetOraclePrice(record)
}
```

---

### Exchange

**Consume**: `index_price`, `mark_price`, `funding_reference`

**Deliver**: Versioned adapter that replaces venue-local price facts with validated Oracle values

**Must Reject**:
- Single venue as index (violates multi-source requirement)
- Stale last-good value for liquidation (unsafe)
- Hidden fallback to local price without explicit status

**Required Evidence**:
- [ ] Index/mark/funding test vector
- [ ] Liquidation breaker drill (halt on circuit breaker)

**Sample Integration**:
```go
func (e *Exchange) GetMarkPrice(market string) (int64, error) {
    price, err := e.oracleClient.GetPrice(ctx, market, "mark_price")
    if err != nil {
        // NEVER fall back to local price silently
        return 0, fmt.Errorf("oracle unavailable: %w", err)
    }
    if price.Quality.CircuitBreaker {
        // HALT liquidations when circuit breaker active
        e.pauseLiquidations(market, "oracle circuit breaker active")
        return 0, errors.New("mark price unsafe: circuit breaker")
    }
    return price.Value, nil
}
```

---

### DEX

**Consume**: `dex_twap`, `spot_price`  
**Produce**: `dex_pool_state`

**Deliver**: 
- Signed pool state observations with chain ID, block hash, reserves
- TWAP consumer for fiat reference pricing

**Must Reject**:
- Same-height pool state replacement without correction event
- Unconfirmed or stale block
- Pool state substituted for aggregated fiat price

**Required Evidence**:
- [ ] Reorg test vector (handles same-height replacement correctly)
- [ ] TWAP window test vector

**Sample Pool Publisher**:
```go
func (d *DEX) PublishPoolState(poolAddr string) error {
    block := d.chain.GetLatestFinalizedBlock()
    pool := d.GetPool(poolAddr)
    
    observation := oracle.Observation{
        ProviderID: "ynx-dex-reporter-1",
        Market: fmt.Sprintf("%s_%s_POOL", pool.Token0, pool.Token1),
        Type: oracle.DEXPoolState,
        PoolState: &oracle.PoolState{
            ChainID: d.chainID,
            Pool: poolAddr,
            Token0: pool.Token0,
            Token1: pool.Token1,
            Reserve0: pool.Reserve0.String(),
            Reserve1: pool.Reserve1.String(),
            BlockNumber: block.Height,
            BlockHash: block.Hash,
        },
        ObservedAt: block.Time,
    }
    
    // Sign with reporter key
    signed, err := d.signer.Sign(observation)
    if err != nil {
        return err
    }
    
    // Submit to Oracle ingestion endpoint
    return d.oracleClient.SubmitObservation(ctx, signed)
}
```

---

### Quant

**Consume**: `spot_price`, `ohlcv`, `trades`, `clob_order_book`

**Deliver**: Oracle reference facts alongside unchanged raw Exchange trades

**Must Reject**:
- Paper/static trades in live mode
- Structured feed (OHLCV, trades, order book) substituted for settlement price

**Required Evidence**:
- [ ] Live/history parity test vector
- [ ] Source lineage display in UI

**Sample Integration**:
```go
// RAW EXCHANGE TRADES (preserve unchanged)
func (q *Quant) GetRawTrades(venue, market string) ([]Trade, error) {
    return q.exchangeAPI.GetTrades(venue, market) // direct exchange API
}

// ORACLE REFERENCE PRICE (for cross-venue analysis)
func (q *Quant) GetReferencePrice(market string) (Price, error) {
    price, err := q.oracleClient.GetPrice(ctx, market, "spot_price")
    if err != nil || price.Quality.SourceCount < 3 {
        return Price{}, errors.New("oracle reference unavailable")
    }
    return Price{
        Value: price.Value, Scale: price.Scale,
        Source: "YNX Oracle multi-source",
        Lineage: price.LineageHash,
    }, nil
}
```

---

### Stablecoin

**Consume**: `stablecoin_price`, `stablecoin_reserve_ratio`, `stablecoin_depeg`

**Deliver**: Separate price, reserve evidence, and depeg signals

**Must Reject**:
- Oracle value as mint/burn authority
- Assumed parity (must check depeg signal)
- Reserve ratio without issuer evidence

**Required Evidence**:
- [ ] Depeg test vector
- [ ] Mint/burn authority separation review

**Sample Integration**:
```go
func (s *Stablecoin) CheckDepeg(stablecoin string) error {
    price, err := s.oracleClient.GetPrice(ctx, stablecoin, "stablecoin_price")
    if err != nil {
        return err
    }
    
    // Check depeg signal (price deviates from $1.00)
    expected := int64(1_000_000) // $1.00 at scale=6
    deviation := abs(price.Value - expected)
    threshold := int64(50_000) // 5% depeg threshold
    
    if deviation > threshold {
        // ALERT: Depeg detected
        s.alerting.SendDepegAlert(stablecoin, price.Value, expected)
        // DO NOT automatically mint/burn based on Oracle alone
        return errors.New("depeg detected, manual review required")
    }
    return nil
}
```

---

### Finance & Pay

**Consume**: `spot_price`, `fx`, `interest_rate_candidate`, `stablecoin_price`

**Deliver**: Quote/display adapter whose expiry derives from asOf

**Must Reject**:
- Expired quote (asOf too old)
- Guaranteed return claims
- Hidden spread or fee

**Required Evidence**:
- [ ] Quote expiry test vector
- [ ] Fee disclosure review

**Sample Integration**:
```go
func (p *Pay) GenerateQuote(from, to string, amount int64) (Quote, error) {
    price, err := p.oracleClient.GetPrice(ctx, from+"/"+to, "fx")
    if err != nil {
        return Quote{}, err
    }
    
    // Quote expiry = asOf + maximum_age
    expiresAt := price.AsOf.Add(30 * time.Second)
    if time.Now().After(expiresAt) {
        return Quote{}, errors.New("oracle price too stale for quote")
    }
    
    // Calculate quote with explicit spread/fee
    rate := float64(price.Value) / math.Pow10(int(price.Scale))
    spread := 0.002 // 0.2% spread
    fee := amount * 0.001 // 0.1% fee
    outputAmount := int64(float64(amount) * rate * (1 - spread))
    
    return Quote{
        From: from, To: to,
        InputAmount: amount,
        OutputAmount: outputAmount,
        Rate: rate,
        Spread: spread,
        Fee: fee,
        ExpiresAt: expiresAt,
        OracleAsOf: price.AsOf,
        OracleLineage: price.LineageHash,
    }, nil
}
```

---

### Explorer & Monitor

**Consume**: `provider_status`, `data_correction`, price quality

**Deliver**: Lineage/correction views and alerts for source changes, staleness, divergence, breaker

**Must Reject**:
- Green status without fresh evidence
- Credential exposure in logs

**Required Evidence**:
- [ ] Public record URL showing Oracle lineage
- [ ] Alert delivery and recovery timestamps

**Sample Integration**:
```go
func (m *Monitor) CheckOracleHealth() error {
    health, err := m.oracleClient.GetHealth(ctx)
    if err != nil {
        m.alerting.Send("Oracle API unreachable")
        return err
    }
    
    if health.Status == "circuit_breaker" {
        m.alerting.Send("Oracle circuit breaker active")
    }
    if health.Status == "limited_sources" {
        m.alerting.Send(fmt.Sprintf("Oracle has only %d/%d sources", 
            health.ProviderCount, health.RequiredProviderCount))
    }
    if health.StalenessSeconds > 60 {
        m.alerting.Send(fmt.Sprintf("Oracle data is %ds stale", 
            health.StalenessSeconds))
    }
    
    // Display provider status publicly
    return m.dashboard.UpdateOracleStatus(health)
}
```

---

### Gateway, Wallet & Auth

**Consume**: Public read routing, optional display

**Deliver**: Canonical rate limits, service admission, request ID propagation

**Must Reject**:
- Provider identity as YNX user identity
- Oracle overriding balances or permissions
- Browser access to internal ingestion endpoint

**Required Evidence**:
- [ ] Gateway route test
- [ ] Auth boundary review
- [ ] CORS denial for ingestion endpoint

**Sample Gateway Config**:
```yaml
# Gateway routes Oracle read endpoints publicly
routes:
  - path: /oracle/health
    upstream: http://oracle-backend:6470/health
    auth: none
    rateLimit: 100/minute
    
  - path: /oracle/prices
    upstream: http://oracle-backend:6470/prices
    auth: none
    rateLimit: 10/second
    
  # BLOCK internal ingestion
  - path: /oracle/internal/*
    action: deny
    reason: "Internal ingestion requires network-level auth, not Gateway"
```

---

### Bridge

**Consume**: `spot_price`, `stablecoin_price`

**Deliver**: Governance-approved risk-limit input only

**Must Reject**:
- Oracle price as release proof (Bridge must verify on-chain lock)
- Stale value
- Source limitation

**Required Evidence**:
- [ ] Risk limit test vector
- [ ] Breaker halt drill

**Sample Integration**:
```go
func (b *Bridge) CheckRiskLimit(asset string, amount int64) error {
    price, err := b.oracleClient.GetPrice(ctx, asset+"/USD", "spot_price")
    if err != nil || price.Quality.CircuitBreaker {
        // FAIL CLOSED: Cannot assess risk without reliable price
        return errors.New("cannot verify risk limit: oracle unavailable")
    }
    
    usdValue := (amount * price.Value) / int64(math.Pow10(int(price.Scale)))
    riskLimit := b.governance.GetRiskLimit(asset) // governance-set limit
    
    if usdValue > riskLimit {
        return fmt.Errorf("exceeds risk limit: $%d > $%d", usdValue, riskLimit)
    }
    return nil
}

// NEVER use Oracle alone as bridge release proof
func (b *Bridge) ReleaseFunds(proof BridgeLockProof) error {
    // Must verify on-chain lock event, not Oracle price
    if !b.chain.VerifyLockEvent(proof) {
        return errors.New("invalid bridge lock proof")
    }
    // Oracle is only for risk limits, NOT release authority
    return b.executeRelease(proof)
}
```

---

## Common Integration Patterns

### Pattern 1: Fail Closed

```go
price, err := client.GetPrice(ctx, market, priceType)
if err != nil {
    // NEVER fall back to unsafe alternative
    return errors.New("oracle unavailable: operation cannot proceed")
}
if price.Quality.CircuitBreaker {
    return errors.New("oracle circuit breaker: operation halted")
}
// Safe to use
```

### Pattern 2: Explicit Staleness Check

```go
maxAge := 30 * time.Second
age := time.Since(price.AsOf)
if age > maxAge {
    return errors.New("price is too stale")
}
```

### Pattern 3: Minimum Confidence Threshold

```go
minConfidence := int64(800_000) // 80%
if price.Quality.ConfidencePPM < minConfidence {
    return errors.New("price confidence too low")
}
```

### Pattern 4: Lineage Tracking

```go
// Store lineage for audit
type PriceRecord struct {
    Value         int64
    AsOf          time.Time
    LineageHash   string
    SourceCount   int
    UsedAt        time.Time
}

record := PriceRecord{
    Value: price.Value,
    AsOf: price.AsOf,
    LineageHash: price.LineageHash,
    SourceCount: price.Quality.SourceCount,
    UsedAt: time.Now(),
}
db.StorePriceRecord(record)
```

---

## Testing Your Integration

### Test Vector Files

**Location**: `integration/oracle/v1/consumer-test-vectors.json`

This file contains accept/reject test cases:
- Valid price (should accept)
- Stale price (should reject)
- Circuit breaker active (should reject)
- Insufficient sources (should reject)
- Low confidence (should reject)
- Schema mismatch (should reject)

### Run Test Vectors

```go
func TestOracleIntegration(t *testing.T) {
    vectors := loadTestVectors("integration/oracle/v1/consumer-test-vectors.json")
    
    for _, vector := range vectors {
        result := myConsumer.ProcessOraclePrice(vector.Input)
        
        if vector.ShouldAccept && result.Rejected {
            t.Errorf("Vector %s: should accept but rejected", vector.Name)
        }
        if !vector.ShouldAccept && !result.Rejected {
            t.Errorf("Vector %s: should reject but accepted", vector.Name)
        }
    }
}
```

---

## Returning Acceptance Evidence

### Create Evidence File

**Path**: `docs/oracle/integration-evidence/[your-product].json`

```json
{
  "product": "YourProduct",
  "owner": "product-owner@ynx.com",
  "sourceCommit": "df817b6...",
  "integrationDate": "2026-07-23",
  "sdkVersion": "sdk/oracle/go v0.1.0",
  "endpoints": ["https://yourproduct.ynx.com/oracle-status"],
  "evidence": [
    {
      "type": "test_vector",
      "result": "pass",
      "file": "internal/yourproduct/oracle_test.go",
      "description": "All consumer test vectors pass"
    },
    {
      "type": "code_review",
      "result": "pass",
      "reviewer": "security-team",
      "description": "No Oracle bypass, fail-closed verified"
    },
    {
      "type": "drill",
      "result": "pass",
      "description": "Circuit breaker halt drill: operation correctly stopped"
    }
  ]
}
```

### Submit via Pull Request

```bash
git checkout -b integration/oracle-yourproduct
git add docs/oracle/integration-evidence/yourproduct.json
git commit -m "feat(yourproduct): return Oracle integration acceptance evidence"
git push origin integration/oracle-yourproduct
# Create PR for Oracle team review
```

---

## Support

- **Integration Questions**: oracle-team@ynx-foundation.com
- **Bug Reports**: GitHub Issues on YNX-Chain repo
- **Emergency**: security@ynx-foundation.com

---

## Appendix: JSON Schema References

- **Price Schema**: `integration/oracle/v1/price.schema.json`
- **Observation Schema**: `integration/oracle/v1/observation.schema.json`
- **Market Data Feed Schema**: `integration/oracle/v1/market-data-feed.schema.json`

---

**Document Owner**: Oracle Engineering  
**Review Date**: 2026-07-23  
**Next Review**: After first consumer integration or quarterly
