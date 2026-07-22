# YNX Quant Lab — Paper & Testnet Preview

Run locally:

```sh
YNX_QUANT_EXCHANGE_URL=http://127.0.0.1:6442 \
YNX_QUANT_STATE_PATH=.ynx/quant-lab/state.json \
go run ./apps/quant-lab/server
```

The configured Exchange must expose `/api/v1/market-data/trades` when the Exchange server is used with its `/api` prefix, so set `YNX_QUANT_EXCHANGE_URL=http://127.0.0.1:6442/api` for the combined Exchange Web server. The tape contains actual YNX-owned venue matches only. Fewer than 20 actual trades makes backtest unavailable; no prices are synthesized.

Writes are loopback-only in this local preview and require the UI's `X-YNX-Preview-Mode: local-paper` boundary. A public staging deployment must replace this local boundary with canonical Central Gateway session authorization; it must not expose the local write mode remotely.

Configuration:

- `YNX_QUANT_HTTP_ADDR` — listener, default `127.0.0.1:6444`.
- `YNX_QUANT_STATE_PATH` — integrity-protected persistent state.
- `YNX_QUANT_EXCHANGE_URL` — Exchange API base for actual matched trades.

Independent binaries:

- `go run ./cmd/ynx-quantd` — authoritative REST and WebSocket API
- `go run ./cmd/ynx-quant-worker` — SHA-256-verified deterministic built-in
  backtest job worker; it never runs arbitrary source or host commands
- `go run ./cmd/ynx-quant-paperd` — paper-only mutation boundary
- `go run ./cmd/ynx-quant-riskd` — risk, mandate, revocation, and bounded
  Testnet boundary
- `go run ./cmd/ynx-quant-web` — static web server and API reverse proxy
- `go run ./cmd/ynx-quant-cli health` — operator CLI; mutations require an
  explicit `--approve` flag and a loopback endpoint

All state-writing daemons coordinate through an atomic cross-process lock and
reload the integrity-protected state before mutation. A timeout fails closed.
The WebSocket endpoint is `/v1/stream`; every envelope declares source, time,
version, and authority confidence.

The standalone SDKs are under `apps/quant-lab/sdk/python` and
`apps/quant-lab/sdk/typescript`. Neither SDK can sign, hold Wallet keys,
withdraw, change ownership, or mutate without explicit caller approval.

Self-hosted candidate:

```sh
SOURCE_COMMIT="$(git rev-parse HEAD)" \
  docker compose -f apps/quant-lab/compose.yaml up --build
```

The web surface binds to `127.0.0.1:6447`. The Compose candidate uses a
non-root, capability-free, read-only container filesystem and a dedicated
state volume. Kubernetes manifests in `apps/quant-lab/k8s` are candidates, not
deployment evidence. Neither packaging format implies staging, public
deployment, canonical Gateway integration, or production signing.

Testnet order submission additionally requires injected `MandateVerifier` and `TestnetBroker` implementations. The shipped server injects neither and therefore fails closed. Real-money execution has no adapter or route.

Strategy lifecycle changes are sequential and fail closed:

`Draft → Research → Backtest → Walk-forward → Paper → Shadow → Candidate → Wallet-approved Bounded Testnet → Paused → Retired → Archived`

The deterministic backtest records Draft, Research, and Backtest audit events.
Every later transition requires an independent risk approval and a SHA-256
evidence digest. Entry into bounded Testnet additionally requires a current,
unrevoked Wallet mandate for the exact strategy hash. Mandate revocation is
immediate, persistent, idempotent, and blocks later submission.
