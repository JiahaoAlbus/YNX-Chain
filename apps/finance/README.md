# YNX Finance

YNX Finance 1.2.0 is an independent, read-only YNXT personal-finance product. It reads account evidence from Explorer and authorized receipts from Pay, then keeps private planning records such as categories, notes, budgets and reminders. It is not a bank, custodian, broker, adviser, lender, insurer, card product or yield product.

## Canonical Wallet boundary

The native app builds the exact `ynx-finance-v1` request with `@ynx-chain/wallet-auth`, opens `ynxwallet://authorize`, verifies the Wallet callback, signs the central Gateway product-device challenge and accepts only the resulting opaque product session. The Go API introspects every bearer session at the Gateway. There is no address login, local HMAC assertion, browser fallback session, Wallet secret or recovery-material path.

Central integration is intentionally **not complete**. The exact registry entry and deterministic vector are under `integration/wallet-auth/`, but the central registry merge, deployed persistent Gateway and installed Wallet approval test remain external gates. Until those gates pass, sign-in fails closed.

## Data and approval boundaries

- YNXT balance and activity are accepted only after Explorer `/health` validates the service and native symbol. Responses carry Explorer release/commit, source `asOf`, RPC/indexed heights, sync lag, sync status and bounded coverage.
- Activity coverage is explicitly the latest 100 indexed records; complete history and an opening balance are not claimed. Pagination cursors are HMAC-signed and bound to the Wallet account plus the current activity snapshot, so tampering, cross-account reuse and stale snapshots fail closed.
- Pay receipts require a configured authenticated Pay API. A missing or invalid key produces an unavailable state, never placeholder receipts; successful responses carry adapter version, response observation time, coverage and sync status.
- Exchange, DEX, Quant and Economics appear through the Finance-owned `finance-source-read-envelope-v1` consumer boundary. All four remain `owner-contract-pending` and unavailable until Integration freezes an owner payload version and Finance explicitly accepts its account-bound, network-bound, read-only capabilities. No balance, position, PnL, APY, supply or fee figure is inferred while pending.
- Optional cross-product actions are reviewed HTTPS navigation links only. They open the owner product and never grant Finance signing, trading, withdrawal, strategy, vault or Treasury mutation authority.
- Categories, notes, budgets, reminders, privacy preferences and audit records are account-scoped local Finance data with provenance.
- AI can draft categories, fee explanations and budgets only from selected owned records with privacy permission and per-request consent. Apply or reject is always explicit; AI cannot move assets or change account controls.
- Reports identify YNXT and the public testnet, carry source coverage and are expressly not bank, tax or legal statements.

## Run

Use `infra/secrets-template/finance.env.template` as the variable inventory, then inject all secret values through an operator-managed secret environment. Start the Go API and the canonical edge Gateway separately:

```bash
go run ./apps/finance/cmd/server
npm ci --prefix packages/wallet-auth
npm ci --prefix apps/finance/gateway
npm start --prefix apps/finance/gateway
```

The default API is `127.0.0.1:6436`; the edge Gateway is `127.0.0.1:8787`. `YNX_FINANCE_CURSOR_SIGNING_KEY` and `YNX_FINANCE_OPERATIONS_KEY` are mandatory, distinct secrets with at least 32 high-entropy characters supplied through the operator secret manager; neither may reuse a Wallet, Pay, AI, backup, provider or signing credential. The operations key protects the process-scoped, financial-data-free `GET /metrics` endpoint. `YNX_FINANCE_EXCHANGE_ACTION_URL`, `YNX_FINANCE_DEX_ACTION_URL`, `YNX_FINANCE_QUANT_ACTION_URL` and `YNX_FINANCE_ECONOMICS_ACTION_URL` are optional reviewed HTTPS navigation routes; they do not configure data adapters or make a source available. Production needs TLS ingress, persistent Gateway replay/revocation storage, secret rotation procedures, a backed-up Finance state volume, a Pay read key and centrally reviewed support/privacy/dispute URLs.

## Backup and recovery

`YNX_FINANCE_BACKUP_AUTH_KEY` is a separate operator-managed high-entropy secret of at least 32 bytes. The admin tool creates mode-`0600` HMAC-SHA-256-authenticated backup envelopes, verifies them without changing live state and restores only after the exact destructive-operation confirmation. Restore is an offline operation: stop every Finance writer first. The envelope is authenticated but not encrypted, so it belongs only on encrypted, access-controlled storage.

```bash
export YNX_FINANCE_BACKUP_AUTH_KEY='<injected by secret manager>'
go run ./apps/finance/cmd/admin backup --state ./var/finance/state.json --output ./var/finance/backups/state.json
go run ./apps/finance/cmd/admin verify --backup ./var/finance/backups/state.json
go run ./apps/finance/cmd/admin restore --state ./var/finance/recovery-drill/state.json --backup ./var/finance/backups/state.json --confirm 'RESTORE FINANCE STATE'
```

See `OPERATIONS.md` and `MIGRATION_COMPATIBILITY.md` before any restore or schema change.

## Verify

```bash
go test ./internal/finance ./apps/finance/cmd/server ./apps/finance/cmd/admin
npm test --prefix packages/wallet-auth
npm test --prefix apps/finance/gateway
npm test --prefix apps/finance
npm run smoke --prefix apps/finance
npm run check --prefix apps/finance/mobile
```

See `product-release.json`, `STATUS_MATRIX.md`, `SECURITY_RECOVERY_AUDIT.md`, `UI_DESIGN_AUDIT.md` and `docs/handoffs/finance.md` for the exact evidence and remaining central gates.
