# Open Questions

## External decisions or inputs

- Which three independent providers have approved benchmark, valuation, redistribution and retention rights for the intended Testnet markets?
- What secure custody path will hold reporter Ed25519 keys and the Oracle state-integrity HMAC key?
- Which exact Integration protocol version will 29 Integration freeze for all consumers?
- When will Chain, Exchange, DEX, Quant, Finance, Pay, Explorer, Monitor, Bridge, Gateway and Wallet/Auth return acceptance evidence?
- Which hosting and signing authorities will publish the public Oracle Web and immutable server/CLI/SDK artifacts?
- Which Linux arm64 execution environment will provide native install, cold-start, `/version` commit and graceful-shutdown evidence?

## Autonomous questions to resolve next

- Which accessibility tooling is already installed under `apps/oracle` for direct keyboard, RTL, large-text, reduced-motion, theme and 390px verification?
- Can the host `python3` SIGKILL condition be isolated without changing system configuration, or should the shared SDK suite remain recorded as an environment blocker while Oracle-specific consumers stay green?

## Resolved in this slice

- Package layout: deterministic macOS arm64 and Linux arm64 server/CLI archives, TypeScript npm candidate and Go module source candidate; no credentials or active provider material are included.
- Provenance/SBOM reuse: the bounded deterministic tar/JSON primitives in `scripts/lib/sdk-release.mjs` are reused, with Oracle-specific verification and evidence export rather than a duplicate archive format.
- Evidence boundary: generated Manifest, Provenance and CycloneDX SBOM are commit-addressed under `release/evidence`; large binary archives remain outside Git.
