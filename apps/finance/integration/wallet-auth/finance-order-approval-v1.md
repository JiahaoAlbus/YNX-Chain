# Finance order approval v1 — frozen shared contract

Status: frozen for Wallet and Finance implementation on 2026-09-19. This is a
testnet + Broker Sandbox approval protocol. It is not a Broker order, chain
transaction, Product Session grant, live-trading permission or production
approval.

Protocol files:

- `finance-order-approval-v1.schema.json`
- `finance-order-approval-v1.vectors.json`

## Cryptographic contract

- Order hash domain: `YNX_FINANCE_ORDER_V1`.
- Approval signature domain: `YNX_FINANCE_ORDER_APPROVAL_V1`.
- Revocation signature domain: `YNX_FINANCE_ORDER_APPROVAL_REVOKE_V1`.
- Each applicable digest is `SHA-256(UTF8(domain + "\n" + canonicalJSON(value)))`.
- `canonicalJSON` is the existing Wallet/Auth implementation: recursively sorted
  object keys; plain enumerable data properties only; no unknown/missing fields,
  accessors, prototypes, floats, `null` substitutions or duplicate JSON keys.
- `orderHash` hashes the exact `order` object. The approval signature hashes the
  exact unsigned envelope including the full order and its hash.
- Signature: secp256k1 compact 64-byte lowercase hex, low-S, no additional
  prehash inside the signer. Public key: compressed 33-byte lowercase hex.
- The YNX account must be derived from that public key and equal the already
  authenticated Finance session account. A proof never authenticates its own
  subject or Broker account.

## Fixed environment and source

`version=1`, `productId=finance`, `applicationId=com.ynxweb4.finance.web`,
`platform=web`, `origin=https://finance.ynxweb4.com`, `chainId=0x1917`,
`chainEnvironment=testnet`, `tradingEnvironment=sandbox`, and
`provider=alpaca_broker`. Version 1 is Web-only because the existing Finance
Product Session authority currently has one verified Web binding. Native
platforms require their own trusted application registry/policy and a later
protocol version; they must not reuse this Web proof.

`requestId`, `callbackStateHash`, `challengeId`, `nonce`, account, subject,
Broker account, source and all order data are signed. Callback matching is still
only correlation; the current product registry and authenticated Finance
session establish source and subject authority.

`subjectId` is not supplied by the client. Finance derives it from already
verified Product Session claims as
`"subject_" + SHA-256("YNX_FINANCE_SUBJECT_V1\n" + canonicalJSON({account,
applicationId,platform,productClientId}))`, with `productClientId` fixed to
`ynx-finance-v1`. Finance stores and compares that exact derived value. This
keeps the subject stable for the same verified Finance account and binding
without trusting a self-asserted identity.

The challenge and proof lifetime is positive and at most 300 seconds. Authority
time is server time. Backgrounding, lock, selected-account change, origin change
or product-binding change invalidates an uncompleted Wallet review.

## Request, callback and revocation transport

`finance-order-approval-v1.transport.schema.json` freezes the outer transport.
The launch route is exactly `ynxwallet://finance-order-approval`; the response
returns through the already trusted Finance Product Session registry callback.
No request may supply an arbitrary callback URL. The request contains the exact
unsigned approval envelope. The callback result is exactly one of:

- `approved`, with the complete signed approval;
- `rejected`, with reason `USER_REJECTED` and no approval;
- `revoked`, with a signed revocation for an approved but unconsumed proof.

Every result repeats `requestId` and `callbackStateHash`. Finance must compare
both with its durable challenge before changing state. A rejection is a
correlated user decision and does not grant authority. Revocation is signed by
the same Wallet account over `requestId`, `approvalDigest`, `account`,
`accountPublicKey`, `revokedAt` and `reason=USER_REVOKED`; Finance verifies it
against the current authenticated account and atomically races revoke against
consume. A consumed proof cannot be revoked. Neither rejection nor revocation
creates or changes a Broker order.

## Order and exact money

Initial scope is one whole-share US-equity limit order, regular session only:
`assetClass=us_equity`, `orderType=limit`, `currency=USD`,
`timeInForce=day`, `extendedHours=false`, side `buy|sell`.

- `qty` is a canonical positive integer string, maximum 1,000,000 shares.
- `limitPrice` is canonical USD decimal with at most four fractional digits.
- `maxCost` and `maxFee` are canonical USD decimals with at most six fractional
  digits. No sign, exponent, comma, leading zero or trailing zero is permitted.
- Decimal values must be parsed into exact scaled integers; JavaScript/Go float
  arithmetic is forbidden.
- Buy: `maxCost = qty * limitPrice + maxFee` exactly.
- Sell: `maxCost = maxFee`; this is the maximum permitted cash debit and is not a
  minimum-proceeds promise. Adding minimum proceeds requires a new protocol.
- `feeBoundSource` is `provider_quote`, `provider_current_schedule` or
  `operator_policy`. Unknown fees are not represented by zero; Finance must
  refuse approval until it can establish a bounded value. A zero `maxFee` is
  valid only when the chosen source explicitly establishes zero.
- `brokerAccountId` and `assetId` use the provider's canonical lowercase UUID
  text. No UUID version is assumed until the official Broker Sandbox schema is
  verified. YNX-generated request, challenge, nonce and order IDs remain UUIDv4.
- `assetId` and `symbol` are checked together against the provider asset record.
  Changing either, or any other field, requires a new approval.

## Ownership and state machine

Wallet owns exact parsing/signing, review UI, explicit approve/reject, expiry,
unused-proof revoke, callback binding and lifecycle cancellation. Wallet does not
contact Alpaca and does not mark the proof consumed.

Finance owns the authenticated subject/account and persistent
subject+provider+sandbox Broker mapping, current asset/quote/fee rules, buying
power or sellable holdings, durable challenge/order/outbox state, signature
verification against trusted context, atomic one-time consumption, provider
`client_order_id`, submission, status, cancel, event cursor and reconciliation.

Approval states: `pending`, `approved`, `rejected`, `revoked`, `expired`,
`consumed`. Only an unexpired `approved` record can transition atomically to
`consumed`. Reject/revoke/expire/consume compete on the same durable record.

Logical order states: `draft`, `approval_pending`, `approved`, `submitting`,
`submitted_unknown`, `submitted`, `partially_filled`, `filled`,
`cancel_requested`, `canceled`, `provider_rejected`, `provider_expired`.
Transport timeout becomes `submitted_unknown`; reconcile the saved provider
correlation and never create a new nonce or blind POST. Replaying a consumed
proof returns the same logical order record. Canceling approval never changes a
submitted order; provider cancellation must be observed before `canceled`.

## Required shared tests

Both implementations consume the same positive vector. Negative vectors mutate
exactly one field: product/source/platform, chain/environment/provider, session
account/public key/subject/Broker account, asset ID/symbol/side/qty/price/cost/
fee, request/state/challenge/nonce, issue/expiry or order hash. Each mutation must
fail without signing, consuming or contacting the provider.

Also reject unknown/missing/non-enumerable/accessor fields, duplicate JSON keys,
noncanonical JSON/decimals, overflow, invalid low-S/public key/signature,
rejected/revoked/expired proofs, concurrent consumption, wrong current mapping,
stale quote, insufficient virtual buying power/holdings, `live`/`mainnet`, and
restart recovery that would otherwise resubmit an unknown order.

This freeze authorizes implementation and local contract tests only. Official
Sandbox verification, public deployment, public verification and production
approval remain false.
