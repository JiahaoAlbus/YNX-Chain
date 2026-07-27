# Evidence index

## Source and tests

- research, lifecycle, paper, mandate, execution, persistence:
  `internal/quantlab/service.go` and `internal/quantlab/service_test.go`
- REST roles, write boundary, WebSocket:
  `internal/quantlab/server.go` and `internal/quantlab/server_test.go`
- deterministic worker: `internal/quantworker`
- operator CLI and approval gates: `internal/quantcli`
- UI/browser/i18n: `apps/quant-lab/tests`
- Python and TypeScript clients: `apps/quant-lab/sdk`
- self-host candidates: `apps/quant-lab/Dockerfile`, `compose.yaml`, and `k8s`

## Local evidence collected 2026-07-22 and refreshed 2026-07-27

- Go package tests and vet: pass
- UI catalog/contract tests: pass
- desktop/mobile/RTL browser tests: pass
- Python SDK: two tests pass; wheel built, 2,575 bytes, SHA-256
  `3c3ca75b704b45bf03670a6dd7ae66cd03bc86a3ee06fdd5f4d181c44925cd0c`
- TypeScript SDK: two tests pass; package dry-run produced four package files
- multi-daemon smoke: core role `all`, cross-process kill observed, authoritative
  source metadata preserved
- Compose config parse: pass
- Kubernetes YAML parse: pass; OpenAPI validation unavailable without a cluster
- Docker arm64 candidate: image built from pinned base digests; all five Compose
  services reached running/healthy state as applicable; core ran as UID/GID 65532
  with a read-only root filesystem, all capabilities dropped and no-new-privileges;
  loopback Preview writes, ordered stop/start persistence, backup SHA verification,
  isolated restore and audit-chain continuity passed
- macOS arm64 desktop: bundle built twice reproducibly, ad-hoc signature verified,
  then cold-launched from a fresh Applications-layout extraction with API/version,
  health, metrics, frontend and clean shutdown checks; this is test signing, not
  production signing or notarization
- Windows x64 desktop: cross-compiled and archived only; not launched or installed
- hostile Origin, oversized JSON and cross-origin WebSocket DAST probes: pass
- local ZIP structural/credential scan: both desktop candidates pass; no external
  CVE, malware or container vulnerability scanner was available, so external
  scan and production-artifact states remain false

Reproducible candidates built from source commit
`8b211d08a67abc9e2b3d3f3254bbc87f4293b08e`:

- macOS arm64 ZIP: 7,377,983 bytes; SHA-256
  `eb44973099a41a4fcaf79fbc636cdaa11c08c9bb3ac4ca79650e26b42dda964f`;
  ad-hoc test signature; fresh extracted cold-start verified
- Windows x64 ZIP: 8,094,598 bytes; SHA-256
  `e6b8c2031b38d7efb1f8b138b9b161851327b82f2a2362d7367ecbbdbdd9ea82`;
  unsigned cross-compile; no Windows execution evidence
- Linux arm64 local OCI image: 41,667,295 bytes; local image ID
  `sha256:70e32c90601dc50c4770d04d40bd684a8bde52848e969afb9e8ddfbbaceb3f35`;
  unsigned and unhosted; runtime/restart/restore verified locally, but this image ID
  is not a registry manifest digest

Browser screenshots are generated under ignored `tmp/quant-lab-evidence` and are
not immutable release evidence. A final release must copy selected evidence into
a commit-addressed artifact, hash it, and attach a hosted immutable URL.

## Missing remote evidence

CI run URL, staging/public health response, canonical Gateway session, Wallet
mandate approval/revoke receipt, Exchange order/fill, DEX vault actions,
Explorer/Finance/Monitor/Trust correlation, registry manifest digest, container
signing/external vulnerability scan/immutable hosting, hosted SDK/download URLs,
production desktop signing/notarization, Windows host launch, and public uptime
evidence.
