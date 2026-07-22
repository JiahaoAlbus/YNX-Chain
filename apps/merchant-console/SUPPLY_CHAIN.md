# Supply-chain controls

- JavaScript dependencies are locked by `package-lock.json`; canonical Wallet Auth is vendored as a versioned tarball.
- Go dependencies are locked by `go.mod` and `go.sum` at repository root.
- Local `npm audit` reported zero known vulnerabilities on 2026-07-22; this is not a future or production guarantee.
- Build uses the checked-in `scripts/build.mjs` and pinned esbuild version.
- `artifacts/sbom/frontend.cdx.json` is a path-sanitized CycloneDX 1.5 frontend SBOM (SHA-256 `14681393bd0afa46d5d1b9649f54493cfdd2b98f784ec974db284f47e8858180`, 7,276 bytes at generation).
- `artifacts/sbom/backend-modules.json` is the path-sanitized machine-readable Go module inventory (SHA-256 `2e7b2e5aebd9fd5abc33e689bdc26d764d64412dda177630640407230b708a1d`, 57,262 bytes at generation).
- `artifacts/sbom/backend.cdx.json` is a deterministic, path-free CycloneDX
  1.5 backend SBOM with 312 components, dependency graph, available Go checksum
  hashes, and source `go.mod`/`go.sum` hashes (SHA-256
  `512441688ca876cac0fe247aac6fe182ef478a66deeca48e71cc63a8b32e9167`,
  260,459 bytes). `npm run sbom:backend` regenerated identical bytes twice.
- Vendored Wallet Auth tarball SHA-256 is `3feb86824135d5143e4e72e506d4efef9f530d3d931081c15500f16b1347bf2f` (11,181 bytes).
- `npm run vendor:verify` records all 13 archive member hashes and exact package
  metadata in `artifacts/vendor/wallet-auth-verification.json` (SHA-256
  `5a29a97fb3a3af5e29802a95bdee1f4640420ec0e67ea8c54309e31fadea9b12`,
  2,863 bytes). The archive declares no source repository/commit or license and
  contains no license file, so provenance is `unverified` and license is
  `NOASSERTION`; distribution approval remains blocked rather than inferred.
- Frontend tests bind the standard backend SBOM to the current `go.mod` and
  `go.sum`, reject local paths/broken references, and bind the vendor manifest
  to the exact tarball bytes while requiring truthful unknown provenance/license.

Release gates: obtain and verify the vendored tarball's authoritative source
commit and license, run SAST/DAST/dependency review/container and artifact scans,
audit lifecycle/build scripts, record full production-bundle reproducibility,
and publish signed provenance plus immutable artifact URL/SHA-256/bytes/signing
class/minimum browser. Local secret-pattern scans are evidence only and do not
replace an approved secret scanner.

No hosted or signed artifact exists yet.
