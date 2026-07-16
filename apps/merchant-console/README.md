# YNX Merchant Console

Responsive Web operations console with separate merchant information
architecture: overview, committed transactions, signed invoices/catalog,
reconciliation/export, webhook operations, refund/dispute cases, bounded AI
workflows, identity/security, and audit.

Set `globalThis.YNX_PAY_API_URL` before loading `app.js` (or serve behind a
deployment configuration that defines it). No fallback points at the central
Pay API: an unconfigured build fails closed. The console derives every metric
and row from the authenticated product service; it contains no merchant or
payment fixtures.

Run `npm run check` to execute record-boundary tests and build `dist/`.

The console supports the same twelve audited locales as the consumer App,
including Arabic RTL, localized dates/numbers/plurals, persistent manual locale
selection and a separate persistent AI output-language selection. Payment,
refund, dispute, authorization and AI authority-boundary strings have strict
nonblank/semantic tests.

Browser acceptance on 2026-07-17 covered 1280x720 Simplified Chinese and
390x844 Arabic RTL. Both layouts had zero horizontal overflow and no browser
console warnings or errors; the mobile operation rail collapsed as designed.
Screenshots are retained under `proof/`.
