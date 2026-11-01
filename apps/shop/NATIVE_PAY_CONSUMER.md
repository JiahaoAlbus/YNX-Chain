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
