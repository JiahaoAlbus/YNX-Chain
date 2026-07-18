# Quant engine evaluation

Evaluation captured 2026-07-18 from official upstream repositories. Third-party engines are not linked into the YNX-owned execution core. Copyleft candidates remain isolated sidecar evaluations pending legal review; notices and attribution must remain intact.

| Candidate | Repository | Exact evaluated commit | License | Backtest / paper / live | Adapter difficulty | Recovery and maintenance risk | Decision |
|---|---|---|---|---|---|---|---|
| NautilusTrader | https://github.com/nautechsystems/nautilus_trader | `3c099fddbc1d12f1a2ada89be0ecd233b6ceb546` (`develop`) | LGPL-3.0 | Unified deterministic simulation and live engine | High: Rust/Python boundary and venue adapter | Strong event model; high release velocity and ABI/integration burden | Isolated sidecar evaluation only; legal review required |
| Freqtrade / FreqAI | https://github.com/freqtrade/freqtrade | `02f6ca2d24a11514bb03d71527e78512bdbc7003` (`develop`); `b604e2fd70539f7f73d3c62c16ce0b155bbab319` (`stable`) | GPL-3.0 | Backtest, dry-run and crypto live adapters | Medium: Python REST/process boundary | Mature recovery surface; GPL and strategy/plugin supply-chain risk | Isolated sidecar research only; never direct execution |
| LEAN | https://github.com/QuantConnect/Lean | `0269115d3cfbf691c7a0b7cfcc9ed412cafb91f6` (`master`) | Apache-2.0 | Backtest and live brokerage model | High: .NET data/brokerage model | Large maintained codebase; operational and data licensing complexity | Future adapter candidate, not bundled |
| YNX event engine | this repository | release commit recorded in product manifest | repository license | Deterministic OOS backtest and persistent paper preview; live funds disabled | Native | Small auditable surface; YNX owns adapters, risk, broker, reconciliation and audit | Selected preview core |

No upstream source or binary is redistributed in this branch. Repository URLs, commits, actual licenses and evaluation notes are metadata only. Historical or simulated performance is not a promise of returns.
