# YNX Quant Lab 0.2 Testnet Candidate release notes

This release introduces an independent research, Paper and bounded Testnet Preview product.

- Deterministic event-driven out-of-sample backtests with fee, slippage, latency, liquidity participation, partial fill, data-gap, buy/hold, no-trade, walk-forward, regime and parameter-sensitivity evidence.
- Strategy provenance records source, commit, license, strategy/model/data/feature hashes, split, seed, parameters, assumptions and limitations.
- Persistent Paper Broker, reconciliation, audit chain and kill switch.
- Wallet-signed bounded Testnet mandate boundary with expiry, notional,
  position, daily-loss, slippage, gas and order-frequency limits; fresh oracle
  and venue-health observations; replay rejection; and idempotent broker proof.
  Default verifier, authoritative risk feed and broker are unavailable; live
  funds remain disabled.
- Market data comes only from the Exchange owned actual-match tape. No synthetic product prices, fake liquidity, fake volume or fake fills.
- 12 locale catalogs, Arabic RTL, light/dark, responsive workbench and reduced motion.
- Upstream evaluation records exact NautilusTrader, Freqtrade/FreqAI and LEAN commits/licenses; no third-party binary is bundled.
- Sequential Draft-to-Archived lifecycle with risk/evidence gates and active
  Wallet mandate requirement before bounded Testnet.
- Immediate, idempotent, restart-persistent mandate revocation.
- Independent core, worker, paper, risk, web, and CLI binaries; REST and
  source-labelled WebSocket; Python and TypeScript SDK candidates.
- Cross-process state coordination, atomic integrity-checked backup/restore,
  tamper rejection, and restore drill.
- Docker Compose and Kubernetes candidates with non-root/read-only boundaries.
  The Docker image is not installed because no local daemon was available.
- SLO/capacity baseline, unit economics, threat model, operations, migration,
  observability, evidence index, release truth record, and public metadata.

Historical and simulated results do not predict returns. This candidate is not
a real-money trading product. It is not centrally integrated, deployed, hosted,
production signed, or store released.
