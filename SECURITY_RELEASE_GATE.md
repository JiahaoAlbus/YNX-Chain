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
  - `release/oracle-image-linux-arm64.cdx.json`, 40,735 bytes, SHA-256
    `c91f9833989ba5e4ff587e4cf4e7770f7b2d71b9e8ebf206881bf6f03114e423`.
- The pinned linux/arm64 image builds as local ID
  `sha256:58c30f0adb0651cffed64c0beac0519a53fc8fe62c113b2a85cc629eb75d7d19`
  (14,570,034 bytes), runs as UID/GID 65532 on a read-only root filesystem,
  and contains a CGO-disabled Go 1.25.12 binary.
- Trivy 0.72.0 reports zero high/critical fixed vulnerabilities in both Alpine
  3.22.5 packages and the Go binary. A local cold start with an explicitly
  inactive test registry returned HTTP 503 `degraded`, active sources 0/3, and
  the exact source limitation while the process remained healthy enough to
  serve diagnostics.
- The repeatable live-container DAST smoke verifies degraded fail-closed health,
  security headers, safe error bodies, path/method/oversized-body rejection,
  internal-ingestion CORS denial, UID 65532, and a read-only root filesystem.

## Open gates

- The full Web development dependency audit reports high-severity advisories
  in Babel, brace-expansion, esbuild, fast-uri, js-yaml, undici, Vite, and ws.
  These packages are excluded from the deployed production dependency set, but
  the build environment is not release-clean. Registry resolution of patched
  Cloudflare/Vite tooling repeatedly timed out, and some advisory-fixed versions
  were not published. Do not produce a signed/public artifact until the full
  audit is clean or a time-bounded, owner-approved exception documents reachability.
- No DAST against a deployed public API/Web origin, penetration test, dependency-review
  CI run, artifact signature, SLSA provenance, or public immutable download exists.
- The Go SBOM generator could not derive the monorepo main-component version
  from the worktree reference; dependencies remain complete and the release
  record must bind its SHA-256 to the final source commit.

## Required artifact gate

Before distribution: build only from the final clean commit; run the full npm
and Go audits; generate per-platform SBOMs; scan filesystem and image; run DAST
on public read routes and rejected internal writes; record bytes, SHA-256,
container digest, signing class, provenance, minimum OS, install, cold-start,
and rollback evidence. The local image ID is not a registry digest or hosted
artifact. A scan failure cannot be converted into a warning by the
release script.
