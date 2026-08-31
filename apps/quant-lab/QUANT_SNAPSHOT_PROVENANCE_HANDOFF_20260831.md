# Quant snapshot provenance handoff — 2026-08-31

## Source checkpoint

- Source commit: `7fc5617ef7992ef405018260bb7145e92fbe2ab2`
- Branch: `codex/quant-owner-contract-snapshot`
- Scope: `internal/quantlab/**` only.
- Local verification passed:
  - `go test ./internal/quantlab ./apps/quant-lab/server`
  - `go vet ./internal/quantlab ./apps/quant-lab/server`
  - `npm --prefix apps/quant-lab test` (6/6)
  - `npm --prefix apps/quant-lab run build:wallet`

## Read contract

HTTP `/v1/snapshot` and the initial `/v1/stream` message now include
`sourceMetadata` alongside the existing compatibility fields. It binds:

```text
source=active Quant persistence source
asOf=the Quant service UTC clock
version=the Quant runtime version
classification=testnet
status=live, degraded_single_host, or unavailable
confidence=authoritative-for-quant-owned-persisted-state
coverage=local research, Paper, and bounded Testnet records
storage=actual persistence backend and multi-instance capability
```

`degraded_single_host` applies to the filesystem JSON backend. It remains
restart-persistent but fails `/ready` for deployable multi-instance service
use. `unavailable` is emitted when the authoritative state refresh fails;
the existing failure envelope remains present. This contract does not assert a
strategy approval, Wallet mandate, sign request, testnet order, capital
deployment, or live-fund execution.

## Central boundary and truth

Central must freeze this response addition or supply a versioned migration for
source-bound Finance/Exchange/DEX consumers. The unchanged public/source-bound
runtime and direct Wallet lifecycle evidence are still missing.

Only `implementedLocal=true` and `testedLocal=true` apply to this source
checkpoint. Public deployment, installed release, product session, Wallet
approval, signing, paper/Testnet execution and transaction evidence remain
false unless separately proven.
