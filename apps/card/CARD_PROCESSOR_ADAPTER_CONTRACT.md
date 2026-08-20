# Card Processor Adapter Contract

## Current implementation

`src/processor.ts` defines the Card Core boundary and supplies only
`TestnetSimulationProcessor`. It uses `YNXT_TESTNET` accounting and the
`YNX_TESTNET_CARD_PAYMENT_SIMULATION` environment. It cannot create a PAN,
CVV, PIN, cryptogram, real-network authorization, fiat movement, or real
merchant payment.

The contract exposes: `createCard`, `getCard`, `freezeCard`, `unfreezeCard`,
`closeCard`, `authorize`, `capture`, `reverse`, `refund`, `getTransaction`,
`getBalance`, `getStatement`, `getControls`, and `updateControls`.

## Invariants

- Funding accepts only a verified `0x1917` transaction reference with a positive
  amount and confirmation count.
- Authorization moves `available` to `pending`; partial capture moves `pending`
  to `posted`; reversal returns `pending` to `available`; refund returns
  `posted` to `available`.
- Every mutating call requires an idempotency key and emits an append-only audit
  event with a safe reason code.
- Card controls and risk decisions execute in the processor, not as display-only
  UI settings.

## Future regulated adapter

`FutureRegulatedProcessorAdapter` must implement the same contract only after
an approved issuer/program manager, processor, network sponsorship, KYC/AML,
sanctions, fraud operations, PCI DSS scope, settlement, disputes, data
localization, legal review, and a secure tokenized card-data reveal mechanism
are present. It must not reuse the Testnet adapter's local storage or emit any
PAN/CVV/PIN data to the Card app.
