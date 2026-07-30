# Supply Chain Security

## Dependency and lockfile review

Go dependency identity is pinned by `go.mod`/`go.sum`; npm contract tooling is pinned by lockfile version 3. The deterministic CycloneDX 1.5 SBOM includes the resolved Go module graph and every locked npm package. `make economics-supply-chain-check` fails when the committed SBOM drifts. Dependency updates require reviewing upstream release/security notes, checksums, license change, generated artifacts and the full test/security gate before merge.

## Scanning truth

`make secret-scan` is a repository pattern scan, not entropy detection or history scanning. `make static-check` runs Go vet plus shell/JavaScript syntax checks; it is not an independent SAST platform. `npm audit` and `govulncheck`, when available and recorded, are dependency vulnerability checks, not proof of exploitability or absence of vulnerabilities. The local HTTP test suite is not external DAST. No container image is produced by this economics package, so no container scan can be claimed; repository assets and local binaries require hash/inventory checks instead.

The 2026-07-22 full npm audit reports three High entries through Hardhat's `adm-zip <0.6.0` dependency and reports no available fix. Hardhat is development-only and this package does not ingest untrusted ZIP input, but the finding remains unresolved and blocks treating the contract-tooling bundle as production-ready. The Go graph and toolchain were upgraded to the scanner-provided fixed versions; a subsequent symbol scan reported no called findings.

## Build and provenance

Only scripts in `release/build-script-allowlist.json` may generate the scoped economics evidence. Reproducibility means two clean local builds from the same source and toolchain produce matching SHA-256 after removing environment-dependent build IDs via documented flags. Local provenance records are not hosted CI attestations and are unsigned. Public artifacts require immutable download URL, digest, bytes, signing class, minimum OS, installation and cold-start evidence before their release flags can change.
