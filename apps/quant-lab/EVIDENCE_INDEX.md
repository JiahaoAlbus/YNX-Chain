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
`eb3767a48d51287f6b4601e0f712a18e734752a7`:

- macOS arm64 ZIP: 7,338,285 bytes; SHA-256
  `235d36c3b362f79607ef70147b991f3e4289591c2930a4aaab00525e0c0c7590`;
  ad-hoc test signature; installed cold-start verified
- Windows x64 ZIP: 8,072,676 bytes; SHA-256
  `72270d4fd26da41e445ad45c49a8e099841131f19b4a8d761952e39b012baa91`;
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
