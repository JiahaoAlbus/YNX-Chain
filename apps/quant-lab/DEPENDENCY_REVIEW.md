# Dependency and license review

The Quant Lab runtime is the repository-owned Go event engine plus the Go standard library. Playwright is development-only. NautilusTrader (LGPL-3.0), Freqtrade/FreqAI (GPL-3.0), and LEAN (Apache-2.0) were evaluated at exact upstream commits in `ENGINE_EVALUATION.md`; none is downloaded, linked, bundled, or represented as the active engine. If a copyleft engine is approved later, it must remain an attributed, separately deployed sidecar behind the owned adapter and pass legal review. Notices are retained in `THIRD_PARTY_NOTICES.md`.

The SBOM deliberately distinguishes evaluated software from shipped components. Testnet brokerage, Wallet mandates, and live connectivity remain adapters with fail-closed defaults; real-funds automation is disabled.
