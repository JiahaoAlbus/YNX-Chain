# Faucet Runtime — P0 Checkpoint

- Owner: Integration
- Task: `P0-012`
- Branch: `codex/p0-faucet-runtime-20260820`
- Commit: `3b80a2fc84af93b5ff5ec9c668a18c0e8d8be011`
- Candidate PR: https://github.com/JiahaoAlbus/YNX-Chain/pull/108
- Tests: `go test ./internal/faucet ./cmd/ynx-faucetd`; `go build ./cmd/ynx-faucetd`; `git diff --check` all passed.

## Delivered source behavior

`/health` now projects a URL-free public health document and `/version` reports build identity, start time and URL-free dependency status. Both responses use `Cache-Control: no-store`. The in-process health model may retain operational detail for metrics, but it is not serialized at public HTTP boundaries.

## Public truth

The 2026-08-20 public probe was still serving the old runtime: it returned `rpcUrl: http://127.0.0.1:6420`; `/version` timed out. Therefore the candidate is not deployed and must not be used to accept the endpoint manifest or mark Wallet Faucet available.

## Next exact action

Review, merge and deploy the exact PR source; then independently request the public `/health` and `/version`, compare commit/release to the deployed artifact, and only then revisit `public-endpoint-manifest.json`.
