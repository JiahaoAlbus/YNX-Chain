# Fees

The authoritative runtime currently uses a fixed 1 YNXT native-transfer or application-action fee credited to the selected validator. Committed state v8 records every charged fee as an audit-bound event whose gross amount must exactly equal validator, provider, protocol, Treasury, and burn allocations. The current policy truthfully records validator allocation at 100% and every other allocation, including burn, at zero.

ABCI exposes `/economics/fees` and `/economics/fees/{id}`. BFT Gateway exposes bounded `GET /economics/fees` and `GET /economics/fees/{id}` responses with `source`, `asOf`, `version`, `coverage`, and explicit failure state.

The runtime does not yet implement EIP-1559 base-fee adjustment, fee burn, per-lane markets, priority fees, or a protocol/Treasury split.

The versioned economics candidate and deterministic simulator are documented in `economics/ECONOMIC_POLICY.md`. Candidate output must not be presented as live chain state. Consensus adoption requires a migration that preserves old-client transaction decoding, adds explicit fee and burn events, and exposes reconciliation through Indexer and Explorer.
