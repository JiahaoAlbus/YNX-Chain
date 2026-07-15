# YNX Merchant Console

Responsive Web operations console with separate merchant information
architecture: overview, committed transactions, signed invoices/catalog,
reconciliation/export, webhook operations, refund/dispute cases, bounded AI
workflows, identity/security, and audit.

Set `globalThis.YNX_PAY_API_URL` before loading `app.js` (or serve behind a
deployment configuration that defines it). The default is a deployment target,
not live-service evidence. The console derives every metric and row from the
authenticated product service; it contains no merchant or payment fixtures.

Run `npm run check` to execute record-boundary tests and build `dist/`.
