# Quant filesystem storage truth handoff — 2026-08-31

## Scope and source

- Product-owned paths: `internal/quantlab/**` and this handoff.
- Source checkpoint: `1487390d75fdffc5e2bbcd8a6fe5e28cdc6205b1`.
- Source tree: `05a3fbf40af4abba70ad85ad6155315e22ec28cb`.
- Fable5 alignment: Quant requires persistent, multi-user-safe state; a file
  snapshot must not be advertised as a multi-instance deployment backend.

## Change

`GET /health` and `GET /version` now return the same machine-readable
`storage` object:

```json
{
  "backend": "filesystem_json_snapshot",
  "restartPersistent": true,
  "crossProcessSharedFilesystem": true,
  "multiInstance": false,
  "productionDatabaseRequired": true
}
```

The existing directory lock and atomic JSON write remain valid only for
processes sharing the same filesystem. This checkpoint deliberately does not
claim cross-node safety or a production database.

## Verification

- `go test ./internal/quantlab ./apps/quant-lab/server` — pass.
- `go build -o /tmp/ynx-quant-storage-truth-test ./apps/quant-lab/server` —
  pass; local Linux host binary SHA-256:
  `55d5fb1013a64845fc844b7fd61e7d137fb73ff368d1f17959a04e180e54c050`.
- `npm --prefix apps/quant-lab test` — 6/6 pass.
- `npm --prefix apps/quant-lab run build:wallet` — pass.

## Integration boundary and remaining work

No database migration, credentials, public deployment, installed-app proof,
provider approval, signature, order, Testnet transaction, or WalletConnect
flow was performed. Before a multi-instance deployment, Central must provide
an approved shared database contract, migration, endpoint configuration, and a
path-scoped release lease. Existing provider-source checks remain source-only;
they are not public or installed lifecycle evidence.
