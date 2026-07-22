# YNX Merchant Console

Responsive Web operations console with separate merchant information
architecture: overview, committed transactions, signed invoices/catalog,
reconciliation/export, webhook operations, refund/dispute cases, bounded AI
workflows, identity/security, and audit.

Set `globalThis.YNX_APP_GATEWAY_URL`; the bundled same-origin runtime routes
merchant API calls through `/app/pay-merchant`. Override
`globalThis.YNX_PAY_API_URL` only when the central Gateway exposes an equivalent
authenticated prefix. Before
loading `app.js` (or inject them through deployment configuration). Login uses
the immutable canonical `@ynx-chain/wallet-auth@1.0.0` package, the
`ynx-merchant-console-v1` registry binding and a short-lived Wallet/Gateway
session. The browser never receives the merchant HMAC credential, webhook
secret, bootstrap key or infrastructure credentials. An unconfigured or
unregistered Gateway fails closed. The console derives every metric and row
from the authenticated product service; it contains no merchant or payment
fixtures.

Run `npm run check` to execute record-boundary tests and build `dist/`.

The console supports the same twelve audited locales as the consumer App,
including Arabic RTL, localized dates/numbers/plurals, persistent manual locale
selection and a separate persistent AI output-language selection. Payment,
refund, dispute, authorization and AI authority-boundary strings have strict
nonblank/semantic tests.

The checked-in screenshots are prior visual evidence only and must not be used
to claim the current Wallet/Gateway build is deployed. Current-version visual
acceptance is recorded in the release evidence after a fresh build is served.
