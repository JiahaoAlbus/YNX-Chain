# YNX Quant Lab Testnet Preview release notes

This release introduces an independent research, Paper and bounded Testnet Preview product.

- Deterministic event-driven out-of-sample backtests with fee, slippage, latency, liquidity participation, partial fill, data-gap, buy/hold, no-trade, walk-forward, regime and parameter-sensitivity evidence.
- Strategy provenance records source, commit, license, strategy/model/data/feature hashes, split, seed, parameters, assumptions and limitations.
- Persistent Paper Broker, reconciliation, audit chain and kill switch.
- Wallet-signed bounded Testnet mandate boundary using the Exchange's exact `ynx-quant-execution-adapter-v1` payload, strategy-bound nonce domain, expiry/capital/position/daily-loss limits, replay rejection and idempotent broker proof.
- Stateless multi-user Exchange bridge: every request supplies its user's short-lived Exchange Wallet session without persistence; every order has a second independent Wallet signature. Concurrent broker calls do not hold the global state lock, while kill/reconcile transitions remain exclusive.
- Testnet UI previews exact mandate and order signing bytes, registers verified mandates and submits signed Testnet limit orders. Missing Exchange deployment/session/signature fails closed; live funds remain disabled.
- Market data comes only from the Exchange owned actual-match tape. No synthetic product prices, fake liquidity, fake volume or fake fills.
- 12 locale catalogs, Arabic RTL, light/dark, responsive workbench and reduced motion.
- Upstream evaluation records exact NautilusTrader, Freqtrade/FreqAI and LEAN commits/licenses; no third-party binary is bundled.

Historical and simulated results do not predict returns. This preview is not a real-money trading product.
