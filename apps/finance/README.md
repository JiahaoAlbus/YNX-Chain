# YNX Finance

YNX Finance 1.2.0 is an independent, read-only YNXT personal-finance product. It reads account evidence from Explorer and authorized receipts from Pay, then keeps private planning records such as categories, notes, budgets and reminders. It is not a bank, custodian, broker, adviser, lender, insurer, card product or yield product.

## Canonical Wallet boundary

The native app builds the exact `ynx-finance-v1` request with `@ynx-chain/wallet-auth`, opens `ynxwallet://authorize`, verifies the Wallet callback, signs the central Gateway product-device challenge and accepts only the resulting opaque product session. The Go API introspects every bearer session at the Gateway. There is no address login, local HMAC assertion, browser fallback session, Wallet secret or recovery-material path.

Central integration is intentionally **not complete**. The exact registry entry and deterministic vector are under `integration/wallet-auth/`, but the central registry merge, deployed persistent Gateway and installed Wallet approval test remain external gates. Until those gates pass, sign-in fails closed.

## Data and approval boundaries

- YNXT balance and activity are live Explorer evidence. Activity coverage is explicitly the latest 100 indexed records; complete history and an opening balance are not claimed.
- Pay receipts require a configured authenticated Pay API. A missing or invalid key produces an unavailable state, never placeholder receipts.
- Categories, notes, budgets, reminders, privacy preferences and audit records are account-scoped local Finance data with provenance.
- AI can draft categories, fee explanations and budgets only from selected owned records with privacy permission and per-request consent. Apply or reject is always explicit; AI cannot move assets or change account controls.
- Reports identify YNXT and the public testnet, carry source coverage and are expressly not bank, tax or legal statements.

## Run

Copy `.env.example` into an operator-managed secret environment. Start the Go API and the canonical edge Gateway separately:

```bash
go run ./apps/finance/cmd/server
npm ci --prefix packages/wallet-auth
npm ci --prefix apps/finance/gateway
npm start --prefix apps/finance/gateway
```

The default API is `127.0.0.1:6436`; the edge Gateway is `127.0.0.1:8787`. Production needs TLS ingress, persistent Gateway replay/revocation storage, a backed-up Finance state volume, a Pay read key and centrally reviewed support/privacy/dispute URLs.

## Verify

```bash
go test ./internal/finance ./apps/finance/cmd/server
npm test --prefix packages/wallet-auth
npm test --prefix apps/finance/gateway
npm test --prefix apps/finance
npm run smoke --prefix apps/finance
npm run check --prefix apps/finance/mobile
```

See `product-release.json`, `STATUS_MATRIX.md`, `SECURITY_RECOVERY_AUDIT.md`, `UI_DESIGN_AUDIT.md` and `docs/handoffs/finance.md` for the exact evidence and remaining central gates.
