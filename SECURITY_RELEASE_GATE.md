# Security and Supply-Chain Release Gate

## Passed locally

- Go 1.25.12 race tests and vet for `internal/oracle`, providers, Go SDK, and daemon.
- `govulncheck v1.6.0` reports **No vulnerabilities found** for reachable
  Oracle server/SDK symbols after raising the toolchain from vulnerable 1.25.7.
- Oracle Web production dependency audit (`npm audit --omit=dev`) reports zero
  vulnerabilities after locking PostCSS 8.5.22 and Sharp 0.35.3.
- Secret-pattern and prohibited-runtime-text scans cover Oracle service, SDK,
  integration artifacts, release records, and Web source.
- Two clean `CGO_ENABLED=0 go build -trimpath -ldflags='-s -w -buildid='`
  builds were byte-identical: 6,170,930 bytes and SHA-256
  `aa0042e1b9a7b4d89d4e1720ec63463361532b577764aac9043fa2713c5e4b27`.
  This is a local unsigned macOS/arm64 proof, not a hosted release artifact.
- CycloneDX 1.6 SBOMs:
  - `release/oracle-server-module.cdx.json`, 93,841 bytes, SHA-256
    `c0624ef8277a29c496fc2c82a152d8173a5203f98d008a64093b9b6b82e23c94`.
  - `release/oracle-web-production.cdx.json`, 9,758 bytes, SHA-256
    `584bb9e402e1a37c9792740e955962f2b9926140dc5a11b736c52424f7f3d0bb`.

## Open gates

- The full Web development dependency audit reports high-severity advisories
  in Babel, brace-expansion, esbuild, fast-uri, js-yaml, undici, Vite, and ws.
  These packages are excluded from the deployed production dependency set, but
  the build environment is not release-clean. Registry resolution of patched
  Cloudflare/Vite tooling repeatedly timed out, and some advisory-fixed versions
  were not published. Do not produce a signed/public artifact until the full
  audit is clean or a time-bounded, owner-approved exception documents reachability.
- The local Docker daemon is unavailable, so the container has not been built,
  scanned, started read-only/non-root, or assigned an immutable digest.
- No DAST against a deployed API/Web origin, penetration test, dependency-review
  CI run, artifact signature, SLSA provenance, or public immutable download exists.
- The Go SBOM generator could not derive the monorepo main-component version
  from the worktree reference; dependencies remain complete and the release
  record must bind its SHA-256 to the final source commit.

## Required artifact gate

Before distribution: build only from the final clean commit; run the full npm
and Go audits; generate per-platform SBOMs; scan filesystem and image; run DAST
on public read routes and rejected internal writes; record bytes, SHA-256,
container digest, signing class, provenance, minimum OS, install, cold-start,
and rollback evidence. A scan failure cannot be converted into a warning by the
release script.
