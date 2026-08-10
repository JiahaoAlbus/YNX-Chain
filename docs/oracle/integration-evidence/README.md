# Oracle Consumer Integration Evidence

This directory contains acceptance evidence from each product owner who has integrated YNX Oracle Market Data.

## Purpose

The Oracle engineering team has delivered:
- Signed observation validation and aggregation algorithms
- Provider registry framework and data integrity store
- Public HTTP API and consumer SDK
- Integration handoff contracts and test vectors

**Each consumer product must return acceptance evidence** proving:
1. Integration implemented per handoff contract
2. Required rejection logic tested
3. Authority boundaries respected
4. Fail-closed behavior verified

## Evidence Format

Each product creates `[product-name].json` with:

```json
{
  "product": "ProductName",
  "owner": "owner-email@ynx.com",
  "sourceCommit": "exact SHA from Oracle repo",
  "integrationDate": "YYYY-MM-DD",
  "sdkVersion": "sdk path and version",
  "endpoints": ["public URLs showing integration"],
  "evidence": [
    {
      "type": "test_vector | code_review | drill | deployment",
      "result": "pass | fail | pending",
      "file": "path/to/test/or/code",
      "description": "what was verified"
    }
  ]
}
```

## Required Evidence Types

### Test Vectors
- All consumer test vectors from `integration/oracle/v1/consumer-test-vectors.json` pass
- Rejection logic correctly handles stale, circuit breaker, low confidence

### Code Review
- No Oracle bypass paths
- Fail-closed behavior confirmed
- Authority boundaries respected (e.g., Oracle does not replace wallet auth)

### Drills
- Circuit breaker halt drill (operation stops when breaker active)
- Provider failover drill (handles source unavailability)
- Staleness rejection drill (rejects old data)

### Deployment (if applicable)
- Public endpoint showing Oracle integration
- Monitoring/alerting for Oracle health
- Incident runbook updated

## Submission Process

1. Implement Oracle integration per `CONSUMER_INTEGRATION_GUIDE.md`
2. Run test vectors and drills
3. Create evidence file: `docs/oracle/integration-evidence/[product].json`
4. Submit PR: `integration/oracle-[product]`
5. Oracle team reviews evidence
6. On approval, `integratedCentral=true` set in release record

## Current Status

| Product | Evidence File | Status | Integration Date |
|---------|---------------|--------|------------------|
| Chain Core | `chain-core.json` | ❌ Pending | — |
| Exchange | `exchange.json` | ❌ Pending | — |
| DEX | `dex.json` | ❌ Pending | — |
| Quant | `quant.json` | ❌ Pending | — |
| Stablecoin | `stablecoin.json` | ❌ Pending | — |
| Finance | `finance.json` | ❌ Pending | — |
| Pay | `pay.json` | ❌ Pending | — |
| Explorer | `explorer.json` | ❌ Pending | — |
| Monitor | `monitor.json` | ❌ Pending | — |
| Gateway | `gateway.json` | ❌ Pending | — |
| Wallet/Auth | `wallet-auth.json` | ❌ Pending | — |
| Bridge | `bridge.json` | ❌ Pending | — |

**Total Integrated**: 0 of 12 products

## Evidence Template

Use `_TEMPLATE.json` as a fail-closed submission skeleton. It contains no pre-approved result, endpoint, reviewer, or deployment claim. Every accepted value must be replaced with exact evidence-backed facts.

## Integration References

- **Integration guide**: `docs/oracle/CONSUMER_INTEGRATION_GUIDE.md`
- **Handoff contract**: `integration/oracle/v1/consumer-handoff.json`
- **Test vectors**: `integration/oracle/v1/consumer-test-vectors.json`
