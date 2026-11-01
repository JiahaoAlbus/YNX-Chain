# Original invoice request read plane

The original `shopd` normal startup calls
`OpenOriginalShopInvoiceReadService(ctx, sameOriginalStoreOpener)`. It borrows
the same already-open Store as Buyer/Seller. It opens no second writer, state
database, account namespace or payment engine. Its sole normal Auth factory
currently returns `SHOP_ORIGINAL_NATIVE_INVOICE_READ_SOURCE_NOT_SUPPLIED`:
the genuine shared Native ProductSource read callee is **not supplied** in this
frozen input. The read plane remains unavailable; public Shop service continues.

The actual consumer/router/lifecycle code is implemented independently of that
missing shared authority. No public setter, JSON, flag, provider callback,
ProductSession, AI task grant, OS peer or copied Root projection can fill the
factory. Only the original Auth adapter may consume its genuine concrete owner
and wrap it into the private consumer seam. PUBLIC authority implementations
exist in `_test.go` only, and are absent from the normal binary.

The dedicated existing LINK private Unix transport admits:

```text
GET /v5/shop/source/shop.order/invoice-intents/{originalOrderID}
```

There is no request body or response envelope. Product ID is fixed `shop.order`.
`OriginalShopInvoiceReadPathFor(productId,sourceOrder)` maps the original two-key
Main selector to that resource path. URL selection conveys no authorization.
The real Auth factory selects the registered socket/service/OS peer and finite
exact original-order paths from protected registration. Existing LINK's64-route
limit is retained. Registration is not broadened to arbitrary templates, query
aliases or a new order. Wallet7a Member3POST2GET scopes are unchanged; the genuine
ProductSource resource-read transport/authority must be independently supplied.

The original request pointer and live OS UID/PID are checked by LINK. The held
Auth read must independently qualify the registered purpose, realm, tenant,
Source epoch, actual canonical product actor/role, Store and original order.
Scope/epoch/current checks and the original order ACL/frozen-bill read share one
original Store lock. Held current must be synchronous/local/no-I/O/no Store
reentry. Full LINK peer/current calls happen outside that lock. Actor, role,
tenant, purpose, epoch and approval are not client inputs.

The response is `application/json`, `Cache-Control:no-store`, with the existing
11-field `NativeShopInvoiceRequestDATA` object. It copies only the retained
original `pay.native-create` Input. It never prices again, creates an invoice,
queries/reconciles Pay or reads a payer's private Wallet/Main journal. The
unchanged Main/P06 `nativeInvoiceProductIntentData` decoder validates and
detaches it, followed by exact productId/sourceOrder comparisons and original
current checks. This object is DATA; no Source brand, signature, approval,
terms/history or financial authority is returned or minted.

Original permission403, not-found404 and changed-bill409 are preserved. Missing
genuine Source remains unavailable. A late current/close/caller failure does
not emit the bill. A failed held close retires this service, retains the child
and first cause, and prevents early authority release. Normal close retires and
joins actual handlers before retrying retained child cleanup and closing the
owned authority. Borrowed Store and other parent resources are not closed.

Affected tests use actual private Unix registration, OS caller, normal service
implementation and cold persisted original Store with explicit PUBLIC Auth
scope controls. They cover exact11 fields/no mutation, source absence, purpose,
epoch, tenant/Store/actor mismatch, late current, ordinary HTTP/clone rejection,
body/query/path refusal, original404/409, close debt and actual handler drain.
They do not prove real Auth/SDK Native Source qualification or installation.
