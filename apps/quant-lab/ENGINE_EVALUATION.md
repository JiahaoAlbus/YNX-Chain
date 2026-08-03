# Quant engine bake-off

Reverified 2026-07-22 against official upstream repository pages and commit
feeds. “Verified head” means the exact commit feed returned during this audit.
“Prior pin” means an earlier exact evaluation remains reproducible but current
head retrieval timed out; it is not represented as current. No candidate is
bundled or approved for execution by this evaluation.

| Candidate | Official source | Commit evidence | License | Event/performance/parity | Portfolio, risk, data, adapters | Maintenance/security/packaging | YNX decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NautilusTrader | https://github.com/nautechsystems/nautilus_trader | prior pin `3c099fddbc1d12f1a2ada89be0ecd233b6ceb546`; current head unavailable | LGPL-3.0 | Rust-native deterministic event engine; strong research/live parity and throughput | rich multi-asset/order-book model and modular adapters | active official page; fast Rust/Python evolution, ABI and LGPL boundary require review | isolated sidecar candidate only; no linking until legal/security approval |
| QuantConnect LEAN | https://github.com/QuantConnect/Lean | prior pin `0269115d3cfbf691c7a0b7cfcc9ed412cafb91f6`; current head unavailable | Apache-2.0 | mature event-driven backtest/live brokerage model; heavier .NET runtime | broad portfolio/risk/data/brokerage abstractions | large maintained surface; data/broker licensing and operational complexity | strongest permissive full-engine adapter candidate; not bundled |
| vectorbt | https://github.com/polakowo/vectorbt | verified head `f9897528f675114e6b34790178dbb2ca137acb51` | Apache-2.0 | very fast vectorized research/optimization; weak event/live parity | strong array analytics, limited execution/reconciliation model | upstream activity is lower than core numerical stack; Python dependency surface | research-only optional process; never execution authority |
| Freqtrade / FreqAI | https://github.com/freqtrade/freqtrade | prior pin `02f6ca2d24a11514bb03d71527e78512bdbc7003`; official API showed activity 2026-07-21, current SHA unavailable | GPL-3.0 | crypto backtest/dry-run/live with ML extension | exchange-focused adapters and risk controls | active, but plugin/model supply chain and GPL boundary are material | isolated research process only; never linked or canonical execution |
| Hummingbot | https://github.com/hummingbot/hummingbot | current head unavailable | Apache-2.0 | event-driven high-frequency CEX/DEX execution focus | extensive connectors, market-making and Gateway model | active official repository; connector/key-handling surface is large | connector behavior reference or isolated adapter candidate; no Wallet keys |
| Backtrader | https://github.com/mementum/backtrader | current head unavailable | GPL-3.0 | readable event-driven backtesting; limited modern live parity/performance | basic broker/data abstractions | low current maintenance signal and copyleft constraints | educational comparison only; reject for runtime |
| TA-Lib | https://github.com/TA-Lib/ta-lib | current head unavailable | BSD-3-Clause | optimized indicator library, not an engine | indicators only; no portfolio/risk/execution | mature C ABI adds native build and memory-safety review | optional isolated indicator component after reproducibility/security review |
| pandas-ta | https://github.com/twopirllc/pandas-ta | official repository returned unavailable during audit | previously MIT; not currently reverified | convenient indicators, not an engine | DataFrame indicators only | source/maintenance/license could not be reverified | reject until official source and license are available |
| Polars | https://github.com/pola-rs/polars | verified head `af10a5233031f2b2475eafdfd4adda2e84c8ad95` | MIT | high-performance columnar data processing; not an event engine | strong research transforms, no execution semantics | highly active Rust/Python project; sizeable dependency footprint | preferred candidate for isolated dataset transforms, pinned before use |
| NumPy / Pandas | https://github.com/numpy/numpy and https://github.com/pandas-dev/pandas | current heads unavailable | BSD-3-Clause | foundational numerical/tabular research; vectorized, not live-parity engines | broad analytics ecosystem; no venue execution contract | mature, widely reviewed, but transitive native supply chain remains | acceptable research dependencies when pinned and included in generated SBOM |
| CCXT | https://github.com/ccxt/ccxt | current head unavailable | MIT | unified REST/WebSocket venue access, not a deterministic engine | broad exchange schemas; venue semantics and precision vary | very high change rate and credential-bearing surface | schema research only or isolated no-withdraw adapter; YNX adapters remain authoritative |
| YNX event engine | this repository | source commit belongs in the release record generated after final commit | repository license | deterministic OOS/walk-forward and paper/bounded-Testnet contracts | YNX lifecycle, mandate, risk, reconciliation, evidence, and source authority | small auditable Go surface; local tests and builds available | selected canonical core; third-party engines cannot become execution authority |

## Selection conclusion

YNX keeps its owned deterministic engine and adapter contracts as the only
authoritative Quant runtime. LEAN and NautilusTrader merit isolated bake-off
prototypes; Polars, NumPy/Pandas, TA-Lib, and vectorbt can support research after
pinning and SBOM review. GPL/LGPL components stay in separately deployed
processes with no code linking, and legal review remains mandatory. CCXT or
Hummingbot may inform connector behavior but cannot receive Wallet keys,
withdrawal rights, or replace YNX risk, mandate, evidence, and reconciliation.

Current-head retrieval was incomplete because several official commit/API
requests timed out. Those rows remain unapproved until exact commit, license
file hash, release status, vulnerability review, and reproducible isolated build
are captured. Historical or simulated performance is not a promise of returns.
