# Card Compliance Boundary

The Card app is not a financial institution, card issuer, acquirer, processor,
or card network. Its present role is a Testnet simulation client.

## Prohibited now

- Fiat balances, bank funding, real payment processing, real issuer processing,
  real merchant payment, network branding, card acceptance claims, or licenses.
- PAN, CVV, CVC, PIN, track data, cryptograms, seed phrases, private keys, or
  processor secrets in Card state, logs, analytics, AI context, tests, assets,
  or evidence.
- Calling the Wallet session completion path, reimplementing Device Proof, or
  modifying the Gateway, wallet protocol, SDK, or central control-plane.

## Required future controls

Any regulated launch requires independent legal/compliance approval, issuer and
processor contracts, PCI DSS scope, KYC/AML/sanctions/fraud operations, secure
data handling, privacy/data-localization review, consumer terms, settlement,
disputes, incident response, and audited production controls.

`productionRealPayments=false` until those external controls and direct public
evidence exist.
