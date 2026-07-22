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

## Local evidence collected 2026-07-22

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
- Docker build: failed before build because local daemon was not running
- macOS arm64 desktop: bundle built, ad-hoc signature verified, installed in the
  user Applications directory, then cold-launched with API/version and frontend
  checks; this is test signing, not production signing or notarization
- Windows x64 desktop: cross-compiled and archived only; not launched or installed

Desktop artifacts built from source commit
`5c8524035e4dfe628331ca3953d5a75b0b6a8cf7`:

- macOS arm64 ZIP: 7,337,643 bytes; SHA-256
  `93667642db45e38d5c8a2ee338ee0ebf92747c7ac483991cf5b3dedf8d66859c`;
  ad-hoc test signature; installed cold-start verified
- Windows x64 ZIP: 8,073,050 bytes; SHA-256
  `cc151dabc4f3b002e5df3814433f5ef1fa83eb916756b825dc5ac3974ed52304`;
  unsigned cross-compile; no Windows execution evidence

Browser screenshots are generated under ignored `tmp/quant-lab-evidence` and are
not immutable release evidence. A final release must copy selected evidence into
a commit-addressed artifact, hash it, and attach a hosted immutable URL.

## Missing remote evidence

CI run URL, staging/public health response, canonical Gateway session, Wallet
mandate approval/revoke receipt, Exchange order/fill, DEX vault actions,
Explorer/Finance/Monitor/Trust correlation, container digest, desktop install,
hosted SDK/download URLs, production signing/notarization, Windows host launch,
and public uptime evidence.
