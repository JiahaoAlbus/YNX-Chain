# YNX Finance

YNX Finance is a separate, read-only personal-finance product for owned YNXT
activity, authorized Pay receipts, budgets, reminders, statements and exports.
It is not a bank, custodian, broker, investment adviser, lender, insurer or
yield product.

## Trust boundary

- Sign-in begins in YNX Wallet. Finance exchanges a five-minute, one-time,
  Gateway-signed assertion bound to `ynx_6423-1`, the `finance` product, the
  exact client, device, account and least-privilege scopes for a short Finance
  session. A browser-supplied address is never accepted as identity.
- Balance and activity come from `ynx-explorerd` at request time. Pay receipts
  come from the configured authenticated Pay API and are filtered to the
  authorized account. Upstream errors remain unavailable states.
- Finance stores only account-scoped categories, budgets, recurring reminders,
  classifications, privacy preferences and audit records. State writes are
  atomic and use mode `0600`.
- AI context requires the privacy toggle, exact owned-record selection and
  per-request consent. Gateway output is a reviewable draft; it cannot sign,
  transfer, trade, borrow, lend, stake, freeze or change account control.

## Run and verify

Copy the values from `.env.example` into an operator-managed environment. Do
not commit real keys. Then run:

```bash
go run ./apps/finance/cmd/server
npm test --prefix apps/finance
bash apps/finance/scripts/smoke.sh
```

The default listen address is `127.0.0.1:6436`. Production ingress, TLS,
Wallet client registration, AI scope registration and Pay read credentials are
central integration responsibilities documented in the handoff.
