# YNX Exchange 0.1.0-testnet

This testnet preview delivers the independent Exchange Mobile and Exchange Pro surfaces backed by a deterministic, persisted YNX-owned venue engine.

Highlights:

- Five native tabs: Markets, Trade, Orders, Assets, and Account; 12 locales with Arabic RTL.
- Canonical Wallet Auth source synchronized from central commit `da82c8b07b72b615ccb24b86a2a7ac66ee85b4d8`; registry requests are exact and pending central acceptance.
- Central-only session introspection and fail-closed protected actions; legacy browser-local challenge/session issuance removed.
- Fixed-point balance reservation, price-time matching, partial/full fills, cancellation, self-trade prevention, fees, nonce/idempotency, replay rejection, tamper rejection, restart recovery, and chained audit.
- DepositIntent requires configured custody plus committed Indexer evidence. Withdrawal stops at reviewed/pending operator broadcast. Cross-chain and production custody are unavailable.
- AI may explain or draft and requires explicit approval for Wallet review; it cannot submit, cancel, withdraw, or mutate security state.
- Public market tape exposes only actual persisted matches. An empty venue returns an empty book/tape—never synthetic liquidity, price, volume, or trades.
- Android Testnet Preview Release built and installed on API 36. iOS production Hermes export passes and a macOS CI job performs Simulator build/install/cold launch/deep link evidence when Xcode is available.

Not production-ready: central Gateway/registry acceptance, custody/indexer/operator adapters, AI provider approval, production signing, staging hosting, and independent security/legal/accessibility reviews remain required.
