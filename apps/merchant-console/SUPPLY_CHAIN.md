# Supply-chain controls

- JavaScript dependencies are locked by `package-lock.json`; canonical Wallet Auth is vendored as a versioned tarball.
- Go dependencies are locked by `go.mod` and `go.sum` at repository root.
- Local `npm audit` reported zero known vulnerabilities on 2026-07-22; this is not a future or production guarantee.
- Build uses the checked-in `scripts/build.mjs` and pinned esbuild version.

Release gates: generate CycloneDX/SPDX SBOMs, verify vendored tarball hash/source/license, run secret scan/SAST/DAST/dependency review/container and artifact scans, audit lifecycle/build scripts, record reproducible build comparison, and publish provenance plus immutable artifact URL/SHA-256/bytes/signing class/minimum browser.

No hosted or signed artifact exists yet.
