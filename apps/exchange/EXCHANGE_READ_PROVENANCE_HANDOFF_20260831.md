# Exchange read provenance handoff — 2026-08-31

## Source checkpoint

- Source commit: `2b3bf20af86f3a6fd62c2e7e361c8c00f2f96c2e`
- Branch: `codex/exchange-a9-runtime-carrier-20260831`
- Product scope: `internal/exchangeproduct/**` and Exchange server read responses.
- Local verification: `go test ./internal/exchangeproduct ./apps/exchange/server ./cmd/ynx-exchange-seed-testnet` and `go vet ./internal/exchangeproduct ./apps/exchange/server` passed.

## Contract

`/v1/markets`, `/v1/orderbook`, `/v1/market-data/trades`, and authenticated
account snapshots include `sourceMetadata`:

```text
authority=YNX-owned deterministic order state
version=exchange-public-state-v1
asOf=current Exchange service clock in UTC
classification=testnet
status=live or degraded_single_host
coverage=the exact response data scope
stateBackend=the active persistence backend
multiInstance=whether the backend supports concurrent service instances
```

The file snapshot backend is explicitly `degraded_single_host`; `/ready`
continues returning 503 for it. A PostgreSQL multi-instance backend may report
`live` only through its actual runtime state. This metadata does not represent
third-party price, volume, liquidity, wallet identity, funds custody or a
public deployment claim.

## Integration and truth

Central must retain this response shape or freeze an explicit versioned
migration before a public web client consumes it. The existing public endpoint
still returns HTML for health/version as recorded by
`EXCHANGE_A9_RUNTIME_ENVELOPE_HANDOFF_20260831.md`; it is not bound to this
source checkpoint.

`implementedLocal=true` and `testedLocal=true` apply only to this source
boundary. Deployment, provider approval, order submission, matching,
settlement, Testnet transaction, installed artifacts, signing and public
runtime proof remain `false` without direct evidence.
