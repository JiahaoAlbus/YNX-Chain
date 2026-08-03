# YNX AI unit economics truth boundary

## Current status

YNX AI does not currently receive canonical Provider usage, quota, invoice, Billing Ledger, protocol-fee, burn, or treasury records. The product therefore keeps `actualUsageReported=false` and does not invent a charge, receipt, or remaining quota.

The UI and API may display estimates only when an operator explicitly configures input and output rates. Those estimates are not Provider invoices and are not canonical YNX billing records.

## Implemented estimate formula

For a locally estimated request:

```text
estimatedProviderCostUSD =
  estimatedInputTokens  × configuredInputUSDPerMillion  / 1,000,000
  + estimatedOutputTokens × configuredOutputUSDPerMillion / 1,000,000
```

Resource units are estimated from the configured resource-units-per-1,000-tokens factor. Every estimated value remains visibly labeled as estimated. When either rate is absent, the money value remains unknown rather than zero.

## Canonical receipt requirements

A future accepted receipt from owner 26 Data Fabric and Billing Ledger must bind at minimum:

- immutable receipt ID;
- request ID and audit ID;
- hashed Wallet account binding;
- conversation ID or privacy-preserving reference;
- Provider and model registry identifiers;
- actual input, cached-input, output, and tool tokens where reported;
- non-token compute or media units where applicable;
- Provider currency, rate source, rate version, and measured Provider cost;
- protocol fee rule and rule version;
- burn, treasury, Provider, and other settlement components;
- chain/network and settlement transaction reference when applicable;
- timestamps, source commit, environment, and signature/provenance;
- correction, reversal, and dispute linkage.

Owner 17 Tokenomics must freeze the fee split semantics. Owner 26 must freeze ledger ingestion, idempotency, correction, and receipt schemas. Owner 14 must not independently define those central economic facts.

## Required negative behavior

YNX AI must fail closed or show `unknown` when:

- Provider usage metadata is absent or malformed;
- Provider and model IDs are not in the accepted Gateway registry;
- a rate version cannot be resolved;
- a Billing Ledger receipt is missing, duplicated, replayed, or account-mismatched;
- fee split components do not reconcile to the canonical total;
- a Provider estimate is presented as an actual charge;
- a local request ID cannot be linked to the audit chain.

## Evidence still required

Before unit economics can move beyond `externalBlocked`, direct shared-Testnet evidence must show actual Provider usage ingestion, canonical Billing Ledger acceptance, fee reconciliation, duplicate/replay rejection, correction handling, and user-visible receipt retrieval. No revenue, margin, burn, treasury, or quota claim is complete before those records exist.
