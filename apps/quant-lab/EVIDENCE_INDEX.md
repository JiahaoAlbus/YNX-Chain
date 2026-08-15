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
  `apps/quant-lab/evidence/local-macos-desktop-cold-start-20260810-70382c37.json`; this is
  test signing, not production signing or notarization
- Windows x64 desktop: cross-compiled and archived only; not launched or installed
- hostile Origin, oversized JSON and cross-origin WebSocket DAST probes: pass
- local ZIP structural/credential scan: both desktop candidates pass; no external
  CVE, malware or container vulnerability scanner was available, so external
  scan and production-artifact states remain false

Current candidates built from source commit
`70382c37ccb8c601c88e72c4cbe189fa072dc5db`:

- macOS arm64 ZIP: 7,395,201 bytes; SHA-256
  `b7f0013ab789f36d8013ee35131b19d92b09d201daac9560c4f989a568cd60d3`;
  ad-hoc test signature; fresh extracted cold-start verified
- Windows x64 ZIP: 8,110,427 bytes; SHA-256
  `a8a2e25e6bdc6a244ca09f491671951a2e0ae210c32b9f17758a31569d4eb1ab`;
  unsigned cross-compile; no Windows execution evidence
- Linux arm64 local OCI image: 41,667,295 bytes; local image ID
  `sha256:70e32c90601dc50c4770d04d40bd684a8bde52848e969afb9e8ddfbbaceb3f35`;
  unsigned and unhosted; runtime/restart/restore verified locally, but this image ID
  is not a registry manifest digest

## Public Testnet evidence collected 2026-08-10

- canonical Wallet -> Quant -> Exchange session, mandate and submitted Testnet
  order flow, replay rejection, restart persistence and tenant-isolation evidence:
  `apps/quant-lab/evidence/public-wallet-quant-exchange-20260810.json`
- Quant, Exchange and Finance public HTTPS health sampled from Singapore,
  Silicon Valley and Seoul: 20/20 HTTP 200 for each service in each region at
  concurrency 10; origin loopback additionally returned 50/50 HTTP 200 for each
  service at concurrency 25. Exact latency samples, runtime source versions and
  the non-SLO measurement boundary are recorded in
  `apps/quant-lab/evidence/public-financial-health-multiregion-20260810.json`.
- the two Quant desktop URLs were downloaded from the Singapore verifier and
  their byte counts and SHA-256 values matched `product-release.json`. The
  macOS archive remains ad-hoc test signed; the Windows archive remains an
  unsigned cross-compile without Windows launch evidence.

## Public Testnet runtime refresh collected 2026-08-15

- Quant and its Exchange owner-read peer were deployed from
  `443286487e057d78cb6b1a686d14bb37be8b3c23` by the guarded
  `scripts/deploy/deploy-financial-owner-reads-testnet.sh` path. The remote
  installer verified the signed, account-bound, replay-protected Quant Finance
  owner-read contract before and after the service switch.
- Public `https://quant.ynxweb4.com/api/health` returned HTTP 200 with the
  deployed commit, `ready:true`, `mode:simulated_testnet_only` and
  `liveFundsEnabled:false`. ComputerControl confirmed the public desktop
  Research view displays an authoritative tape, a reproducible OOS workflow,
  explicit fee/slippage assumptions, isolated state and no live funds.
- Immutable deployment inputs, binary/web hashes and rollback backup are in
  `apps/quant-lab/evidence/public-financial-owner-reads-deployment-20260815-44328648.json`.

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

CI run URL, Wallet mandate revoke receipt, an authoritative Exchange fill (the
current public flow proves only the older `submitted_testnet` build; the local candidate now preserves authoritative Exchange order ID/status/digest and has an isolated real-fill integration test), DEX vault actions,
Explorer/Finance/Monitor/Trust correlation, registry manifest digest, container
signing/external vulnerability scan and immutable container/SDK hosting,
production desktop signing/notarization, Windows host launch, sustained public
uptime and business-action capacity evidence.
