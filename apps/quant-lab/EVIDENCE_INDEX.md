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

## Local evidence collected 2026-07-22 and refreshed 2026-07-29

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
  health, metrics, frontend and clean shutdown checks; machine-readable evidence:
  `apps/quant-lab/evidence/local-macos-desktop-cold-start-20260810.json`; this is
  test signing, not production signing or notarization
- Windows x64 desktop: cross-compiled and archived only; not launched or installed
- hostile Origin, oversized JSON and cross-origin WebSocket DAST probes: pass
- local ZIP structural/credential scan: both desktop candidates pass; no external
  CVE, malware or container vulnerability scanner was available, so external
  scan and production-artifact states remain false

Reproducible candidates built from source commit
`909031e510272e9f92a11d9e9dc8553a1934692f`:

- macOS arm64 ZIP: 7,378,056 bytes; SHA-256
  `5edff1d728ef8430b2a8ea983696e7ce756cb46f20593e56eae7e98ce415c395`;
  ad-hoc test signature; fresh extracted cold-start verified
- Windows x64 ZIP: 8,094,216 bytes; SHA-256
  `491816aa6101fa544af4f2da4459b364bb71245a82a0a06ad889c206a1ae90e7`;
  unsigned cross-compile; no Windows execution evidence
- Linux arm64 local OCI image: 41,667,295 bytes; local image ID
  `sha256:70e32c90601dc50c4770d04d40bd684a8bde52848e969afb9e8ddfbbaceb3f35`;
  unsigned and unhosted; runtime/restart/restore verified locally, but this image ID
  is not a registry manifest digest

Browser screenshots are generated under ignored `tmp/quant-lab-evidence` and are
not immutable release evidence. A final release must copy selected evidence into
a commit-addressed artifact, hash it, and attach a hosted immutable URL.

The 2026-07-29 desktop refresh used Go 1.25.7 on Darwin arm64. Source inputs
and archive byte counts remained stable, but hashes differed from the earlier
host/toolchain evidence; the current hashes reproduced across two clean builds
and the macOS archive was re-verified from a fresh extraction.

## Public Testnet research evidence collected 2026-08-03

- canonical URL: `https://quant.ynxweb4.com/`; source-bound fallback:
  `https://quant-testnet.43.153.202.237.sslip.io/`
- deployed binary commit: `18a73981b04361e4dc5e75706d4b96203fb8d76f`
- authoritative input: 30 actual matches created by the YNX-owned deterministic
  Testnet matching engine; the adapter reports `synthetic: false`
- public state model: a fresh integrity-checked workspace per request; no shared
  user experiment, strategy, Paper, Wallet, or order state
- capacity probe from the public host: 100/100 research requests returned HTTP
  201 at concurrency 50, and 100/100 status requests returned HTTP 200
- reverse-proxy boundary: proxied requests cannot enable local Paper, Risk, or
  Testnet mutation routes by supplying the local preview header
- public capabilities: research enabled; Paper, Testnet order submission, and
  live funds disabled

## Missing remote evidence

Green merge CI, canonical Gateway session, Wallet mandate approval/revoke
receipt, Wallet-authorized Exchange order/fill, DEX vault actions,
Explorer/Finance/Monitor/Trust correlation, registry manifest digest, container
signing/external vulnerability scan/immutable hosting, hosted SDK/download URLs,
production desktop signing/notarization, Windows host launch, and extended
public uptime evidence.
