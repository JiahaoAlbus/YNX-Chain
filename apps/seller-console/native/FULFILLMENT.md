# Original Native Seller fulfillment

`runFulfillmentCLI` in `fulfillment-cli.mjs` follows P07-05 on the existing Shop
Store, shipping transition, Seller role/permission check, and original mutation
identity namespace. It borrows the original protected Seller `api`, actual
current account/Source fence, and `createMutationIntents` storage/lock. No default
client, signer, session, Role/Source setter, Pay request, new ledger or website
entry is supplied. The original host must qualify its actual Native caller; an
`account()` string or callback does not grant server authority.

- `inspect`: empty body, `GET /api/orders/{originalOrderID}`. The same actual
  account must own or have the current store Seller-read permission. Output
  is limited to order/store/status and shipment metadata; buyer identity,
  address, contact and arbitrary private order fields are not emitted.
- `ship`: body exactly `{Carrier,TrackingNumber}`, preserving actual string
  bytes. Carrier must contain text within120 UTF-8 bytes; tracking within200.
  The existing original mutation journal prepares and saves its opaque key/
  digest before dispatch, then marks UNKNOWN immediately before the original
  signed `POST /api/orders/{id}/transition`. The body uses the existing action
  `shipped`; no status or quantity can be injected. Server independently requires
  current Seller `fulfillment.write`, accepted original payment, and the original
  legal order transition. Shipping is not a second inventory deduction.
- `recover-ship`: requires that same original body/account/order identity already
  exist. Only `POST /api/seller/mutations/lookup` runs, with exact original Method,
  Path, OriginalBody and key. No shipping POST, replacement tracking, new shipping
  identity or original result overwrite is attempted. The returned original
  actor/order/store/key/shipment must match before clearing only this identity.
  A fresh authorized lookup proof is still required; it does not replace the
  original shipping operation. A later legal order status is permitted only
  with the same original shipment.

Output is `fulfillmentOnly:true, fundsVerified:false`. A shipping result is not
payment/refund proof or Main/Root admission. An invalid/foreign/late response,
changed account/Source, denied role or edited UNKNOWN leaves the original
identity intact. Independent orders keep their own original account/path
namespaces; a refusal on an unpaid order does not freeze an unrelated paid one.

The original `warehouse-cli.mjs` still owns approved-return goods receipt and
explicit restock. This module does not receive goods, automatically restock,
request or execute a refund, edit an old invoice or alter accepted Native money.

`check-fulfillment-cli.mjs` uses the existing byte-pinned official Native R9
supplier and original opaque mutation helper. It runs only the new fulfillment
source cases and bundles the PUBLIC subprocess fixture. The actual Go check
`TestFulfillmentCLIActualHTTPNativePaidColdOriginalRecovery` drives the real
Node function, normal Shop HTTP handler and cold Store. Its Native receipt/
principal controls are PUBLIC fixtures: this test does not rerun or relabel the
already separate actual Core/Pay cumulative100/100/0 proof journey, and it does
not prove genuine protected installation, Root or real customer fulfillment.
