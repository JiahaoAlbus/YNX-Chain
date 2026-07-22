# Data governance and dataset catalog contract

Every dataset version must record:

- dataset ID/version, content hash, schema, row/byte count, lineage and producer
- provider, official source, license/terms version, jurisdiction, authentication,
  permitted research/backtest/display/execution use, retention and deletion rights
- source timestamp, ingestion time, timezone, calendar, precision, units and
  corporate/protocol correction policy
- coverage by venue/asset/time/data type, missing intervals, duplicates,
  ordering errors, confidence and explicit failure state
- survivorship universe, delisting/depeg treatment, split/dividend corrections,
  and look-ahead controls

Catalog data types are OHLCV, trades, order-book snapshots/deltas, funding,
oracle observations, and DEX pool/liquidity state. Provider values are
third-party observations and cannot become authoritative Wallet identity,
balance, permission, chain transaction, settlement, receipt, or Trust state.

The current local adapter consumes actual YNX Exchange match history and rejects
malformed ordering, invalid precision, insufficient history, and unavailable
sources. It does not synthesize product prices, fills, volume, or liquidity.
Full funding, oracle, order-book, DEX pool, correction, and delisting catalogs
are not yet implemented.

Private datasets require explicit per-dataset cloud consent, least-privilege
access, encryption, audit, expiry, export/delete, and provider-right validation.
They cannot be silently reused for AI training or another user. Default retention
for public market-derived experiment inputs is version-policy controlled; user
private source and generated records require a published retention schedule
before staging.
