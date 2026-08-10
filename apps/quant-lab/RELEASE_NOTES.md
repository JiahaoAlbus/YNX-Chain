# YNX Quant Lab 0.2 Testnet Candidate release notes

This release introduces an independent research, Paper and bounded Testnet Preview product.

- Deterministic event-driven out-of-sample backtests with fee, slippage, latency, liquidity participation, partial fill, data-gap, buy/hold, no-trade, walk-forward, regime and parameter-sensitivity evidence.
- Strategy provenance records source, commit, license, strategy/model/data/feature hashes, split, seed, parameters, assumptions and limitations.
- Persistent Paper Broker, reconciliation, audit chain and kill switch.
- Versioned venue-neutral execution intent with tested Paper and non-submitting
  Shadow adapters, idempotent replay, sequence-gap rejection and explicit
  source/as-of/coverage/confidence evidence. Adapter reservation/result evidence
  survives restart, while interrupted unknown outcomes refuse duplicate
  execution. A stateless Exchange owner transport with request-scoped user
  sessions, exact Wallet signing payloads and independent order signatures is
  implemented and locally tested; the DEX transport is not shipped.
- Wallet-signed bounded Testnet mandate boundary with expiry, notional,
  position, daily-loss, slippage, gas and order-frequency limits; fresh oracle
  and venue-health observations; projected leverage, drawdown, liquidity, depeg,
  concentration, cancel/API reliability and supplied VaR/ES limits; overflow
  rejection; replay rejection; and idempotent broker proof.
  The shipped server can inject the Exchange mandate verifier and Testnet
  broker when `YNX_QUANT_EXCHANGE_URL` is configured. Public product
  registration remains pending/disabled, and there is no authenticated public
  user execution receipt or authoritative production risk-feed claim; live
  funds remain disabled.
- Market data comes only from the Exchange-owned actual-match tape. The product does not infer prices, liquidity, volume, or fills that are absent from authoritative matches.
- 12 locale catalogs, Arabic RTL, light/dark, responsive workbench and reduced motion.
- Upstream evaluation records exact NautilusTrader, Freqtrade/FreqAI and LEAN commits/licenses; no third-party binary is bundled.
- Sequential Draft-to-Archived lifecycle with risk/evidence gates and active
  Wallet mandate requirement before bounded Testnet.
- Immediate, idempotent, restart-persistent mandate revocation.
- Independent core, worker, paper, risk, web, and CLI binaries; REST and
  source-labelled WebSocket; Python and TypeScript SDK candidates.
- Tested research-only strategy template and venue-neutral Shadow intent
  example; no executable unsigned package or invented venue receipt is shipped.
- Cross-process state coordination, atomic integrity-checked backup/restore,
  tamper rejection, and restore drill.
- Docker Compose and Kubernetes candidates with non-root/read-only boundaries.
  The Docker image is not installed because no local daemon was available.
- SLO/capacity baseline, unit economics, threat model, operations, migration,
  observability, evidence index, release truth record, and public metadata.
- Validated/generated request and trace IDs, stable error IDs, redacted JSON
  route logs, WebSocket correlation and bounded Prometheus operational/risk
  metrics. No trace backend, dashboard, monitor ingestion or alert delivery is
  claimed.

The web research preview is deployed at `https://quant.ynxweb4.com/` from source
`9596d94fb3fa315fa32cdbb5ec8e0849a87397db`. Its market-backed verification used
30 persisted, YNX-owned Exchange matches, completed an out-of-sample backtest,
survived service restart, and passed 20 concurrent public snapshot reads.

Commit-addressed macOS arm64 and Windows x64 Testnet candidate archives are
directly hosted on the Quant domain. The macOS archive is ad-hoc signed and
cold-start verified; the Windows archive remains unsigned and host-unverified.

Historical and simulated results do not predict returns. This preview is not a
real-money trading product. It is not centrally Wallet-integrated, tenant
isolated, production signed, or store released. The Exchange execution
workbench described above is not claimed public until a new runtime commit and
deployment evidence supersede the currently attested commit.
