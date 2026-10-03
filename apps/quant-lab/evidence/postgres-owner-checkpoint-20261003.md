# Quant isolated PostgreSQL owner checkpoint

Classification: `ISOLATED_NATIVE_POSTGRES_QA_NOT_PUBLIC_ACCEPTANCE`.

Source: `a71914ce94df9f72e6d5013981012fe89e55db72`, tree
`528893fdd0eb832ccce3d93cc302e828c49d4f93`, clean before execution.
Branch: `codex/exchange-sso-cookie-binding-20261002`.
No product or shared protocol implementation was changed by this checkpoint.

## Executed command

```sh
node apps/quant-lab/scripts/test-postgres-isolated.mjs --postgres-bin-dir /tmp/ynx-quant-postgres-qa.7c340A/runtime/bin
```

Runner SHA-256: `b9a2fef5ae793e0657ea53bb77a371ca430f3883df7a21aeaf7bb9d83a255cdc`.
PostgreSQL executable SHA-256: `038ff8ec454ef37da4c7d88b7b461cb8de8203146ff1ea6f11d3a9632a84551e`.
Version: PostgreSQL 17.11. Isolated local database only; no production database.

## Direct results

- Process exit: 0.
- Focused race-enabled integration passes: 20 (ten required cases, twice).
- Full race-enabled Quant/read-integration regression passes: 116.
- Multi-instance CAS, tenant isolation, replay/idempotency, paper risk/kill fencing,
  scheduler recovery and readiness recovery covered by the existing required cases.
- Database stop/start and durable probe read verified.
- Remaining fixture state/nonce rows: `0|0`.
- Owned test server stopped successfully; QA cluster and logs retained, not deleted.

Raw local receipt: `/private/tmp/ynx-quant-postgres-it-9pOVM5/receipt.json`.
Receipt SHA-256: `64c0999f855670e2e8b2a2ca57f5f8154a23983403a2319e00361d78793ec989`.
Focused log-content digest: `8c60aa9be0216263aad4611f113a567ea91f4e9cfbbd24c7dc79513a09c5e68b`.
Full regression log-content digest: `389a58f86b610095f4ce80fa3562f69528117c4ef6a3d3c6a9e0826fb1517ed8`.
Restart probe read digest: `d12178268dd40e53efd441a2491a94bfc9b58c9bf244ed1d02227f40c8fabaf9`.
Row receipt digest: `875fb9aea8c2545a2c454189edc13d8bb66d1622577ac46cc8c414cbb2613841`.
The raw receipt additionally records all phase digests. Local temporary evidence is
not claimed to be remote artifact hosting or a production release.

## Integration boundary and executable remaining dependency

Release owner must publish a coherent source-bound successor and configure the
production PostgreSQL namespace/writer-version fences before asserting public
multi-instance persistence. The last public readback still identified source
`664b80b00ac576317524f25b49fc01d1c0db7196`, filesystem snapshot storage and
`multiInstance=false`; this execution did not query or mutate that runtime.
Do not replace formal pins, Host, Wallet/Auth, SSO or release authority with this
inherited checkout. Consume only owner-scoped ordinary changes through the
current release graph. Unsupported older writers must not silently drop risk or
attribution fields; rollback requires an explicit compatible storage contract.

Public deployment, installed runtime, real wallet approval, signature,
Product Session, real orders/transactions and user acceptance remain unproved.
No account approval, signature, transaction, public service or secret was used.
