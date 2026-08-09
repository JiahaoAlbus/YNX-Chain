# YNX Exchange 0.1.0-testnet

This testnet preview delivers the independent Exchange Mobile and Exchange Pro surfaces backed by a deterministic, persisted YNX-owned venue engine.

Highlights:

- Five native tabs: Markets, Trade, Orders, Assets, and Account; 12 locales with Arabic RTL.
- Canonical Wallet Auth is deployed from central commit `ec2d2e6e2b16a877be71f5d8a02694b2454ac0a0`; the exact Exchange client, bundle, callback and five scopes are approved and enabled for public-Testnet Product Sessions.
- Native session completion uses `POST /v1/wallet/sessions/complete`; every account request carries a fresh sender-constrained P-256 proof to `POST /v1/wallet/sessions/introspect`. Bearer-only and legacy challenge/session routes are absent.
- Public completion and `exchange:read` introspection both returned HTTP 200; the bounded receipt is `integration/public-wallet-session-evidence-20260804.json`.
- Fixed-point balance reservation, price-time matching, partial/full fills, cancellation, self-trade prevention, fees, nonce/idempotency, replay rejection, tamper rejection, restart recovery, and chained audit.
- DepositIntent requires configured custody plus committed Indexer evidence. Withdrawal stops at reviewed/pending operator broadcast. Cross-chain and production custody are unavailable.
- AI may explain or draft and requires explicit approval for Wallet review; it cannot submit, cancel, withdraw, or mutate security state.
- Public market tape exposes only actual persisted matches. An empty venue returns an empty book/tape—never synthetic liquidity, price, volume, or trades.
- Android Testnet Preview Release built and installed on API 36. iOS production Hermes export passes and a macOS CI job performs Simulator build/install/cold launch/deep link evidence when Xcode is available.

Not production-ready: Wallet-approved product-action signing, withdrawal broadcast/custody operations, cross-chain routing, AI provider approval, production signing, store release, and independent security/legal/accessibility reviews remain required.
