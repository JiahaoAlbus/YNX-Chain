# YNX Exchange third-party notices

This summary accompanies the machine-readable SBOM and lockfiles; upstream license texts remain authoritative. Regenerate and review notices for every final artifact. This is not legal advice.

Direct Go runtime dependencies:

- CometBFT — Apache License 2.0
- decred secp256k1 — ISC License
- Gorilla WebSocket — BSD 2-Clause License
- Go cryptography packages (`golang.org/x/crypto`) — BSD 3-Clause License

Exchange web/mobile direct dependencies include:

- React and React Native — MIT License
- Expo modules — MIT License
- noble curves/hashes — MIT License
- Lucide React Native — ISC License
- Playwright (development/browser testing only) — Apache License 2.0

The complete transitive inventory is recorded by `go.sum`, `apps/exchange/package-lock.json`, `apps/exchange/mobile/package-lock.json`, and `apps/exchange/SBOM.cdx.json`. Vendored canonical Wallet Auth code requires its own central-project license/provenance confirmation before public distribution. No evaluated Quant engine is bundled by the Exchange Adapter.

Final release gates: regenerate CycloneDX SBOM from the exact source commit, scan all shipped binaries/bundles, include full required license texts and attributions, verify vendored-source provenance, review copyleft/notice obligations, and bind SBOM/notices SHA-256 to the release record.
