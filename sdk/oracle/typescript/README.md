# YNX Oracle TypeScript consumer SDK

This package validates YNX Oracle scalar responses before a TypeScript or JavaScript consumer uses them. It is a consumer safety boundary, not a price provider and not a signing component.

## Safety properties

- rejects unknown response fields and unsupported schema or price types;
- binds market, type, policy version, maximum age, confidence, and coverage to the consumer request;
- rejects stale, future-dated, circuit-breaker, failed, thin-source, or low-confidence values;
- validates observation and lineage hashes;
- validates versioned index, funding, mark, DEX TWAP, and stablecoin reserve derivations;
- restricts plain HTTP to loopback development endpoints;
- requires positive request timeouts and bounds response bodies to 1 MiB by default.

## Example

```ts
import { OracleClient, validatePrice } from "@ynx/oracle-client";

const client = new OracleClient("https://oracle-testnet.example", {
  timeoutMs: 5_000,
});

const price = await client.price("YNXT/YUSD_TEST", "spot_price");
validatePrice(price, {
  requestedMarket: "YNXT/YUSD_TEST",
  requestedType: "spot_price",
  expectedVersion: "weighted-median-mad-v1",
  maximumAgeMs: 30_000,
  minimumConfidencePpm: 900_000,
  minimumCoveragePpm: 1_000_000,
});
```

Consumers must still stop settlement, liquidation, valuation, or execution when validation fails. A degraded public endpoint or last-good value is not authoritative.

## Verification

```bash
npm install
npm test
```

The test suite consumes `integration/oracle/v1/consumer-test-vectors.json`, the same canonical accept/reject fixtures used by the Go SDK.
