# Card Processor Adapter Contract

## Current implementation

`src/processor.ts` defines the Card Core boundary and supplies only
`TestnetSimulationProcessor`. It uses `YNXT_TESTNET` accounting and the
`YNX_TESTNET_CARD_PAYMENT_SIMULATION` environment. It cannot create a PAN,
CVV, PIN, cryptogram, real-network authorization, fiat movement, or real
merchant payment.

Construct `TestnetSimulationProcessor(walletAccount)` for one canonical owner.
The instance is not an authentication service. It keeps no durable state, does
not fetch a receipt, and cannot establish real funding from a supplied hash or
confirmation count. Its public-funding, persistent-backend, signature and
broadcast capability flags remain false. Resetting the process loses the
ledger and deduplication records; never use it as the public top-up authority.

The contract exposes: `createCard`, `getCard`, `freezeCard`, `unfreezeCard`,
`closeCard`, `authorize`, `capture`, `reverse`, `refund`, `getTransaction`,
`getBalance`, `getStatement`, `getControls`, and `updateControls`.

## Invariants

- Local funding accepts a syntactically valid **synthetic** `0x1917` reference
  with positive safe-integer amount and confirmation count. The historical
  `TESTNET_FUNDING_CONFIRMED` reason code is retained for the simulation mapper;
  it is not a chain-verification result. The same owner/chain/hash credits once
  across all that owner's cards, including case changes and different retry keys.
- Every completed request binds its key to the full canonical payload and
  operation, including the supplied virtual timestamp. A changed request conflicts.
  Exact retries return the original immutable response; read current state
  separately after later operations. Rejected malformed requests do not reserve keys.
- Authorization moves `available` to `pending`; partial capture moves `pending`
  to `posted`; reversal returns `pending` to `available`; refund returns
  `posted` to `available`.
- Every mutating call requires an idempotency key and emits an append-only audit
  event with a safe reason code.
- Card controls and risk decisions execute in the processor, not as display-only
  UI settings.
- Controls are validated at creation and update; all input arrays are copied and
  deeply frozen. Available, pending and posted balances and their total remain
  nonnegative safe integers. Limit aggregation uses integer arithmetic.
- The local clock is explicit canonical UTC and cannot go backwards. New
  operations and `recover(cardId, now)` release all expired remaining holds before
  settlement. Getters report the last processed virtual time, not wall-clock expiry.
  Closed cards cannot reopen, accept new funding or change controls. Closing with
  unexpired pending holds fails; refunds of prior captures remain possible.

The page currently calls the remote contracts in `src/api.ts`; it does not use
this processor as a hidden fallback. The missing durable backend and shared
Wallet migration are tracked in `evidence/card-sandbox-backend-contract-20260906.md`.

## Future regulated adapter

`FutureRegulatedProcessorAdapter` must implement the same contract only after
an approved issuer/program manager, processor, network sponsorship, KYC/AML,
sanctions, fraud operations, PCI DSS scope, settlement, disputes, data
localization, legal review, and a secure tokenized card-data reveal mechanism
are present. It must not reuse the Testnet adapter's local storage or emit any
PAN/CVV/PIN data to the Card app.
