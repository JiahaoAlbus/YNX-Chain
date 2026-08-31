# Quant source-bound publication preparation — 2026-08-31

Scope is `apps/quant-lab/**` only. This handoff freezes a Linux amd64 candidate
from source `9b1ff8b264a50210d44d600916bf02d42f570871` (tree
`f963d8deee2224e4e43bfae73bc9d5047e3cee51`) without changing any server,
Caddy, systemd unit, production route, account, signature, order, or strategy.

## Candidate

`evidence/release-candidates/ynx-quant-lab-9b1ff8b264a5-linux-amd64-runtime.tar.gz`
is 3,007,376 bytes with SHA-256
`d07caa1e3a6c6ac6df8c499c3992d6c385812938f18fc90599959ad9476a916a`.
It contains static x86-64 `ynx-quantd` (7,028,920 bytes, SHA-256
`cbd5a1d7b5e9f2a725c2b5475350b38cb4e5a08b59ea2e950d9f2c7d25e81dff`),
seven served Web assets, and a `SHA256SUMS` manifest that deliberately excludes
itself. The archive inventory has ten entries.

The candidate preserves the accepted Standard Wallet source consumption from
Wallet/Auth `98c6d5d784d212df8981a53b17118a511e246ad2` / tree
`51a60a362d4ad5dd748bcdefb101f71b1d9e0cee`. Its only supported network is
YNX Testnet `6423` / `0x1917`.

## Local checks

- `npm --prefix apps/quant-lab run build:wallet` — passed.
- `npm --prefix apps/quant-lab test` — 5/5 passed.
- `go test ./internal/quantlab ./cmd/ynx-quantd ./cmd/ynx-quant-web` — passed.

## Public truth and single blocker

Fresh direct reads show the existing public `/api/health` and `/api/version`
identify commit `443286487e057d78cb6b1a686d14bb37be8b3c23`, not this candidate.
They are therefore not source-bound proof for `9b1ff8`. No deployment or wallet
lifecycle claim is made.

The sole next step is a new Quant-only Central deployment lease that freshly
binds the runtime target, active release and rollback pointer, service process,
environment/state policy, immutable stage/backup/release paths, and public API
response inventory. Until such a lease exists, do not use SSH or change server
configuration, Caddy, systemd, or production routing.
