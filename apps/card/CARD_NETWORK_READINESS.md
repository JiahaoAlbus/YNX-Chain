# Card Network Readiness

## Current environment

YNX Card is `YNX TESTNET CARD PAYMENT SIMULATION`. The only asset is
`YNXT_TESTNET`; merchant records are simulated. There is no issuer, acquirer,
card network, BIN, real merchant acceptance, fiat funding, clearing,
settlement, dispute, or production launch.

## Required before any regulated processor adapter

1. Regulated issuer or program-manager agreement and network sponsorship.
2. Processor integration, acquiring/clearing model, settlement accounts, fees,
   refund/reversal/dispute operations, and reconciled financial controls.
3. Jurisdictional KYC/AML, sanctions, fraud, consumer disclosure, privacy, tax,
   cardholder support, and legal approval.
4. PCI DSS segmentation and a provider-hosted tokenized reveal flow. The Card
   app must never persist PAN, CVV, PIN, track data, or cryptograms.
5. Production incident response, key management, monitoring, audits, rollback,
   retention, data-localization, and external security review.

No readiness item above is asserted as complete by this repository.
