# Finance local two-launch smoke — 2026-08-31

Scope: source-only local verification. This is not a deployment, public
runtime, wallet approval, Product Session, or Testnet-transaction claim.

## Execution

The Finance server was built from the current Finance owner branch and started
twice in succession on `127.0.0.1:16483`. Both launches used an explicit local
development override:

```text
YNX_FINANCE_REQUIRE_MULTI_INSTANCE=false
YNX_FINANCE_STATE_PATH=<isolated temporary state file>
```

The server was terminated cleanly after each successful `/health` and `/ready`
read. No remote services, wallet endpoint, account request, signing action, or
chain-writing endpoint was invoked.

## Exact local evidence

```text
local binary SHA-256: d67c6062b253f74fd829096b1f6fec7aca8252916182fd8c41e2b876306a495e
first /health SHA-256: c2e6b7432fd47a28fccdab08b70821397a38b4279d8ca196ac08b378edd38b81
first /ready SHA-256: 805f739c1645b64e1216654938e4226101d487ee3b76946d1ecbddfe6d255551
second /health SHA-256: c2e6b7432fd47a28fccdab08b70821397a38b4279d8ca196ac08b378edd38b81
second /ready SHA-256: 805f739c1645b64e1216654938e4226101d487ee3b76946d1ecbddfe6d255551
```

Both responses reported these intentional local-only values:

```json
{
  "multiInstanceState": false,
  "stateStore": "file-cas-single-host",
  "rateLimitStore": "memory-sliding-window-single-process"
}
```

The production command defaults `YNX_FINANCE_REQUIRE_MULTI_INSTANCE` to true
and requires a PostgreSQL configuration. The pending Central zero-write
preflight must still identify the non-secret PostgreSQL injection mechanism
and current production rollback binding before any deployment lease can be
considered.
