# Original Native Seller return decision

`runReturnDecisionCLI` borrows the same original protected Seller API, current
actor/Source fence and opaque mutation journal as the other Native Seller
entries. It exposes `inspect`, `approve`, `reject`, `recover-approve` and
`recover-reject`. It never imports a grant, caller approval, payment/refund
receipt, balance, goods receipt or stock result. No Source/role/signing factory
or default public transport is introduced.

`inspect` GETs only the actual original owned/store-authorized order and returns
order/store/status/latest original return request ID. Buyer contacts, address,
free-text request and financial records are not emitted.

Approval takes exactly `{ReturnID}`; rejection takes exactly
`{ReturnID,Explanation}` with actual nonempty explanation within5000 UTF-8 bytes.
The normal write first reads the same current original order; it must still be
`return_requested` and name that exact latest original request. It then sends the
existing signed `POST /api/orders/{id}/transition` with action
`return_approved`/`return_rejected`, `OriginalReturnID` and the actual explanation.

The original Store now checks this optional `OriginalReturnID` under the SAME
order mutex, AFTER the original current Seller `returns.resolve` permission
check and before idempotency/transition. The selector cannot grant permission.
It is permitted only for return approval/rejection and must exactly equal the
stored original request event. A wrong order/request is rejected, including a
stale selector or a same-key attempt to replace it. The selector is included in
the semantic idempotency digest and the matching original Seller lookup.

Legacy callers that omit this field retain byte-for-byte the prior semantic
request serialization; no snapshot schema migration, old-body/key rewrite or
permission downgrade is performed. Existing fulfilled/shipped/other transitions
continue their original validation. Opposite decisions for one original request
remain serialized and apply at most once.

A lost decision response retains UNKNOWN in the existing journal. Recovery
calls ONLY `/api/seller/mutations/lookup` with the exact original method/path/
body/key, never a second read of a replacement current request or a decision
POST. The returned original actor/key/order/store and that exact request's
historical decision event must match. A decision belonging to a later request
cannot acknowledge the earlier one. Invalid/foreign/late results preserve the
original identity. Only the current permitted original result clears it.

Outputs are `returnDecisionOnly:true,fundsVerified:false`. Approval does not mean
refund paid, goods received or stock restored. Existing original Native Pay
receipts and separate `warehouse-cli` receive/restock retain their independent
authorities and original IDs. Source/role/Caller/Root qualification and real
installed GUI acceptance remain with their original owners.

New tests use PUBLIC original receipt/principal controls and the byte-pinned
original official SDK for the actual Node/normal HTTP/cold Store path. The
previous independent actual Core/Pay100/100/0 flow is reused, not rerun or
reclassified as this caller's real protected authorization.
