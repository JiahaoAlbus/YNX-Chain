# Shop consumer of P06 Native Pay

`NativeShopPayClient` consumes the eight fixed product routes from P06 source
`1ce6c496d416fcb34def07911f87a8bf76b279a2`. It requires an explicitly supplied
original service HTTP transport and one HTTPS origin. It carries exact atom
strings and original Member bytes, preserves request/response bytes for the
existing business-effect journal, refuses redirects and never retries a send.
`Reconcile` calls only the original hash route; it never falls back to broadcast.

The signing and funds routes remain product transport adapters. The original
intent observation is connected to the normal protected Shop controller below.
It does not register a merchant, select a Source, produce an approval or Member,
decode a CORE funds proof, apply paid/refunded balances, or restock inventory.
Successful HTTP exchange means a response was received, including a possible
`unknown` operation; it does not establish finality. A failed mutating exchange
returns the original request and `Uncertain=true`, including HTTP rejection.

The normal controller must use the existing signed Shop BusinessEffects flow
and durable original selection. It still needs the actual protected
`ProductMerchantID <-> StoreID <-> merchant account` mapping, approved original
order/price/payer, original Native signing approval, and P06's independently
verified same-invoice cumulative payment/refund evidence. Those cannot be
inferred from legacy invoice IDs, payout address equality or a client response.
Until supplied, existing order state and separate physical return inventory
remain unchanged. No create/sign/pay/refund route is enabled by this adapter.

Affected tests cover the fixed routes and exact source order/Member/uint64 atom
serialization, lost-response retention without retry, redirects, unusable
responses, transport absence and invalid locators. These are PUBLIC product
contract tests, not a live Source, Native signature or funds integration test.

The current P06 intent successor supplies existing-operation recovery at
`GET /v5/pay/invoice-intents/{originalOperation}` and
`POST /v5/pay/invoice-intents/{originalOperation}/reconcile`. Shop consumes both
through `ReadOriginalInvoiceIntent` / `ReconcileOriginalInvoiceIntent`, using
the same stable canonical `npi_` ID. It sends no replacement product request,
price, Member, nonce or signing review. SourceOrder/store/merchant authorization
and the retained original bill remain with P06's real Source/read path. A lost
response does not retry or create an intent. PREPARED/signed_not_submitted and
ISSUED are not payment. No notification is allowed to alter Shop paid/refund or
inventory state; original product refresh remains a read-only original-order
lookup with actual authorization. These are raw transport results, never a
replacement for P06's qualified financial reader or Core proof.

## Normal order and independent clients

The existing V2 business router now admits
`GET /api/orders/{id}/native-pay-intent` with the original Buyer read/action
proof and the narrow `account:read`, `shop:orders:write` scopes. The operation
comes exclusively from that Buyer's original stored `Order.PayIntentID`.
Request JSON cannot select an operation, caller, merchant, bill or endpoint.
The normal `commerce_v2` startup passes the original owner's borrowed
`NativeShopPayClient` into the same original Store/server composition after
the protected Shop profile loads. It is absent by default, including when the
profile/transport is not supplied; no ENV/default HTTP enrollment is added.
The hosting transport owner retains its cleanup obligation and must drain the
borrower before releasing that original caller. This does not start a second
Pay daemon or import a substitute Pay Source.

Observation reuses the original BusinessEffects action and dispatch journal,
retaining exact original Pay response bytes before any late private rejection.
Only a GET of the fixed original `npi_` operation can dispatch. Cold recovery
uses a fresh signed observation of the same original order; an unresolved read
cannot admit a create, signature or broadcast. Expired/cancelled orders can
still read their original operation. The Pay reply must match the original
operation, Shop product, Store/order, merchant, recipient and invoice binding.
Only the bounded stage is returned; private bill DomainData and embedded
invoice/funds fields remain outside the client DTO. `queryOnly=true` and
`fundsVerified=false` are mandatory even for ISSUED.

Apple and Android normal check-payment actions select this GET for Native
intent orders, validate the exact original operation and read-only flags, and
refresh the original Shop order independently. They do not replace local
order state from intent stage, queue a payment or open a signing approval.
Historical non-Native orders retain their original settlement path.

Delta tests exercise the real Store/router/journal plus PUBLIC Pay wire
fixtures; Apple uses actual API/SDK-proof ports and Android uses the actual
consumer/policy classes. They cover original-order cold restart, lost response,
cancelled-order lookup, wrong binding/actor, late revocation and no funds or
inventory change. The original Native CI now runs these recovery checks and
builds the normal service. This is source and bounded consumer verification;
commissioned protected Source/Root, matched installed Main/client and financial
end-to-end acceptance remain separate. No live funds or deployment is claimed.

## Normal independent API candidate

The original `shopd` supports `--native-api` on the app's existing fixed
`shop-api.ynxweb4.com` API origin. It opens/recoveries the same original Shop
Store and mounts its original public catalog engine plus the complete original
protected Buyer handler. It serves no Web assets or identity/seller fallback.
Without commissioned role/actor inputs, public catalog reads still work and
private operations return unavailable. The hosting reverse proxy retains its
original HTTPS responsibility; the local CLI listen address remains loopback
by default. A candidate can be started with:

```sh
ynx-shopd-commerce-v2 --native-api --http 127.0.0.1:8095 --state /absolute/original/shop-state.json
```

Use the existing original state/integrity-key configuration for a real install;
an empty isolated QA state is not user data or an authorized private account.
Native mode rejects another Host, encoded/unclean paths and private query aliases,
and passes the actual original request/proof to the protected handler unchanged.

The missing normal V2 dependency is installed byte-identically from the prior
approved 258 delivery, pinned in `normal-native-session-suppliers.json`; the
current Core14/account-address package and root modules are unchanged. A prior
Shop loader referenced a nonexistent Auth `LoadProtectedBrowserSeal` symbol.
The repaired product loader reads only its existing raw 32-byte cookie operand:
descriptor-relative, no symlink ancestors, protected ownership/permissions,
single regular-file link and unchanged inode/size. It does not generate a seal,
load an account, register a backend or replace the independent Source.Current
guard. Tests use explicitly PUBLIC temporary seal bytes; no production material
is read. Auth's original PKCS8 signing-key loader is unchanged.

Native API mode also sets `NativeInvoiceOnly`: an unbound order cannot fall
through to the old invoice creator. The actual Native bill/merchant/terms Source
and original Main approval path must be connected first. Refusal leaves the
original nonce/effect admission untouched. Existing bound invoice references
remain recoverable without creating another operation. The 2026-11-01 P06 normal
host inventory explicitly reports `PAY_HOST_ORIGINAL_ENGINE_SOURCE_CONTRACT_NOT_LINKED`;
this is a real supplier composition gap, separate from Root registration, and
must not be hidden by a legacy service key or a replacement Shop Source.

## Native creation and original approval navigation successor

The actual V2 Buyer routes now include `POST /api/orders/{id}/native-pay-intent`
and `POST /api/orders/{id}/native-pay-intent-lookup`, with only
`{IdempotencyKey}`. `NativeInvoiceDATA` is the original pricing/bill DATA reader:
it supplies the exact approved Native atoms, network and merchant association
DATA for the detached actual owned checkout. No legacy amount conversion or
current-catalog repricing occurs. This DATA port creates no Source, membership,
signature, approval or terms: the actual P06 joint Shop/Pay Source independently
checks the complete request and derives its own CORE terms. Missing either
side stays unavailable, and the existing Cloud-only Source family is unchanged.

The same original BusinessEffects record captures the complete immutable
request before exactly one Pay create POST. An ambiguous attempt cannot create
again, choose a new key or read new prices. Explicit lookup uses the retained
original bytes and only P06's fixed lookup endpoint. A successful authenticated
reply must match the whole request, original npi, merchant/recipient and exact
Money terms. The reference attaches only to the same original order. Lookup
may recover a cancelled order's original reference without changing its status,
reservation or funds. It resolves the original product record while preserving
its unknown dispatch Step and actual original response evidence.

The normal startup borrows `nativePay` and `nativeInvoiceDATA` into the same
original Store/Buyer composition. Main's Source-owned
`readOriginalInvoiceIntent({productId,sourceOrder},current)` can read the
captured product DATA through `ReadOriginalShopNativeInvoiceRequestDATA` using
the actual authenticated actor/role. That resource read does not authorize Pay.
The exact working production contract is also recorded in the owning P07
`NATIVE_ORDER_HANDOFF_CONTRACT.md` coordination file.

Apple and Android keep the original key, attempted/UNKNOWN state and npi in
their existing encrypted product stores. New creation needs an explicit click;
cold opening/return only performs original lookup or GET. The reference is
durable before calling the original typed Main navigation port. Missing Main
bridge keeps it and reports unavailable; it never synthesizes a URL or capsule.
The normal Main adapter consumes P06's fixed read-only `intent` action for both
opening and cold/UNKNOWN navigation. P06's `recover-intent` action performs a
reconcile POST, so navigation must not select it. The adapter validates returned
original references, retains independent-finality=false and preserves the
actual Source absence reason as its error cause. It never approves, signs,
sends or invokes the Pay broadcast callee.
The original Main owner supplies that real protected UI/IPC bridge and queue.

Supplier successor `cc6514d8ab9747ba2232dee3bea4996f2034b9e4` was consumed
from its SHA-verified source archive. Its actual entry/client and the Shop
adapter were checked together: both navigation paths issue only the same
original intent GET, and an absent or retired Source prevents further reads.
P01's specific `requestPQPayBroadcast` implementation is supplied at
`a437d525a7d35d31a9ef664629433bcaa1df4901`; the remaining owning CODE includes
the actual Native Source getter/recognizer, joint Shop order/store/merchant/price
Source and protected installed Main bridge. The existing Cloud-only family
does not supply these Shop inputs.

Service privacy deletion preserves any original Native create record or bound
Native intent even when the Shop order is cancelled/expired. A completed
product effect only records receipt of an intent reference; a lookup may still
retain the original POST's UNKNOWN step. Neither is authoritative financial
termination. Until the real terminal financial reader is composed, deletion
fails before changing the original Store, request, reference or recovery
evidence. This matches the independent clients' existing conservative guard;
an unattempted cancelled order retains its normal deletion path.

The original Pay Source, actual Main navigation/Native Source composition,
matching installed images and real approval/funds acceptance remain distinct
gates. Consumer tests use PUBLIC ports, actual product Store/journal and native
models; the frozen actual P06 normal entry also verifies honest Source-absent
refusal without constructing Main or authority. No such check is a real payment.
