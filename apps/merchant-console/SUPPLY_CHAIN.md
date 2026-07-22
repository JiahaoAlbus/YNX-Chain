# Supply-chain controls

- JavaScript dependencies are locked by `package-lock.json`; canonical Wallet Auth is vendored as a versioned tarball.
- Go dependencies are locked by `go.mod` and `go.sum` at repository root.
- Local `npm audit` reported zero known vulnerabilities on 2026-07-22; this is not a future or production guarantee.
- Build uses the checked-in `scripts/build.mjs` and pinned esbuild version.
- `artifacts/sbom/frontend.cdx.json` is a path-sanitized CycloneDX 1.5 frontend SBOM (SHA-256 `14681393bd0afa46d5d1b9649f54493cfdd2b98f784ec974db284f47e8858180`, 7,276 bytes at generation).
- `artifacts/sbom/backend-modules.json` is the path-sanitized machine-readable Go module inventory (SHA-256 `2e7b2e5aebd9fd5abc33e689bdc26d764d64412dda177630640407230b708a1d`, 57,262 bytes at generation).
- Vendored Wallet Auth tarball SHA-256 is `3feb86824135d5143e4e72e506d4efef9f530d3d931081c15500f16b1347bf2f` (11,181 bytes).

Release gates: generate a standards-format backend SBOM, verify vendored tarball source/license, run secret scan/SAST/DAST/dependency review/container and artifact scans, audit lifecycle/build scripts, record reproducible build comparison, and publish provenance plus immutable artifact URL/SHA-256/bytes/signing class/minimum browser.

No hosted or signed artifact exists yet.
