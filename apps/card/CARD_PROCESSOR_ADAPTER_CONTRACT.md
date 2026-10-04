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

## Durable Testnet product path

`server/service.ts` supplies the owned persistent Card business lifecycle using
the original encrypted SQLite `server/storage.ts`. It has wallet-bound
applications and explicit approval, zero-funded card creation, funding intents,
server-side Core receipt verification, replay-protected ledger credit,
authorization/capture/reversal/refund, controls, statements, reconciliation,
original-key recovery and an immutable-event outbox. Ledger values are exact wei,
not the local processor's integer demo units. These are separate contracts; do
not silently replace one with the other or credit a durable account from a local
processor event.

`src/cardBusinessClient.ts` and the private application/action UI consume the
source-bound `/api/card/v1/*` contract. `server/core.ts` reads actual chain
transactions, receipts, canonical blocks and confirmations; it does not send
transactions. `server/protectedStartup.ts` requires genuine current authority,
and Wallet approval/registered role inputs remain shared-owner capabilities.
Software authority seams in tests are not admitted production inputs.

Historical `src/api.ts` and the legacy page funding controls still target
`/app/card/v1/testnet/*`. Their existing exact-wallet transaction helper is not
evidence that the new durable registered-card UI has completed an end-to-end
funding flow. Legacy routes are not Product Session v2 migration proof. Complete
delivery must pair the new approved provider/intent send-and-recovery UI with the
new durable Card API, then directly verify chain credit and owner ledger state.

The earlier missing-backend note in
`evidence/card-sandbox-backend-contract-20260906.md` is historical evidence, not
the current implementation inventory. Preserve it rather than rewriting it.
The in-memory processor remains local simulation only and is never a hidden
funding or authentication fallback. The persistent backend's existence likewise
does not prove formal Host deployment, real Wallet approval, YNXT funding,
Data Fabric delivery or full product readiness.

## Future regulated adapter

`FutureRegulatedProcessorAdapter` must implement the same contract only after
an approved issuer/program manager, processor, network sponsorship, KYC/AML,
sanctions, fraud operations, PCI DSS scope, settlement, disputes, data
localization, legal review, and a secure tokenized card-data reveal mechanism
are present. It must not reuse the Testnet adapter's local storage or emit any
PAN/CVV/PIN data to the Card app.
