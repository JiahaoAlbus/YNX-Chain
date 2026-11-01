# Original partial-return warehouse command

This continues the original `ReceiveReturn` and `RestockReturn` engine. It does
not create a second warehouse, payment ledger, role, Source or journal.

The independent `shopd --native-api` mounts these fixed Seller routes through
the existing complete protected Seller handler:

- `POST /api/seller/orders/{id}/warehouse` with `{}` reads bounded warehouse DATA.
- `POST /api/orders/{id}/return-receipts` records explicit partial goods receipt.
- `POST /api/orders/{id}/return-restock` explicitly stocks one original receipt.
- The existing `POST /api/seller/mutations/lookup` recovers each original action.

There is no Buyer/legacy fallback after a Seller refusal. Existing current
Source, action proof and Store membership are mandatory. The read requires a
current fulfillment, inventory or return-resolution role and reveals no buyer
address, price, raw payment/refund proof or actor identifiers. Ordered, received
and remaining quantities are exact decimal strings. Returned receipt references
and approved original return IDs are DATA; `QueryOnly=true`, `FundsVerified=false`.

`runWarehouseCLI` borrows the original runtime's `account`, `current`, `api` and
`createMutationIntents` instance with its original durable identity store/lock.
It never constructs an identity, credential, endpoint, Source or storage adapter.
Commands always include the original `orderID` and `storeID`:

- `inspect`: empty body; reads the bounded original view, without a mutation key.
- `receive`: `{ReturnID,EvidenceReference,Items:[{ProductID,VariantID,Quantity}]}`.
- `restock`: `{ReceiptID}` for the independently received original receipt.
- `recover-receive` / `recover-restock`: the same original operands; only lookup.

The original journal supplies the idempotency key and saves UNKNOWN before the
actual transport write. Failed/ambiguous actions cannot rotate that key, order,
warehouse evidence reference or quantity. A cold invocation uses the fixed
original lookup; malformed/rebound replies and account loss preserve recovery.
An already restocked receipt can be recovered without applying stock again.
Each response is reduced to its exact order/Store/receipt/quantity association;
it cannot set paid/refunded or infer financial finality from HTTP success.

The original backend still owns approved-return selection, authoritative original
settlement checks, role separation, cumulative return quantity, store-wide
evidence-reference uniqueness, atomic inventory updates and replay protection.
Receiving goods does not restock; restocking does not refund. New shipment
and restock effects also require the retained original settlement to match the
original order; a paid status flag or goods receipt alone cannot replace it.
Exact already-completed operation readback remains separate from a new effect. The Native CI runs
the unchanged official SDK pin plus actual CLI processes/HTTP/original Store
through lost receive and lost restock replies, with cold Store reopening after
each. Its financial/Auth/current/storage ports are explicitly PUBLIC fixtures,
not a real Seller enrollment, original Wallet approval, real funds or deployment.
