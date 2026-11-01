# Original Native payment receipt and returns

The existing signed buyer `POST /api/orders/{id}/confirm-payment` selects its
mode from the original Store order. Legacy orders keep their existing verifier.
An original `npi_` order enters `nativePaymentReceiptEffect`, which requires the
original protected runtime's borrowed qualified `NativePay` client. There is
no receipt JSON body, exported Store Apply(DATA), webhook, caller URL, signer,
new approval, settlement POST or refund POST.

The server captures the retained completed `pay.native-create` request, its
original session and signing-message hash, exact merchant/recipient/unit/atom
price and same original bill. It queries only P06's fixed normal product route:

    GET /v5/pay/products/shop.order/{originalOrder}/invoices/{merchant}/{invoice}/archive-reconciliation

P06's real normal handler holds its own product Source, invoice-read Source and
independent proof trust and runs its existing Core verifier. The borrowed
protected transport is mandatory: a public JSON `proofVerification`,
`SourceAdmission`, `finalized` or `nativeGrant` flag is not a substitute. The
Shop consumer checks the returned DATA against the retained original; it does
not create another verifier, trust anchor, grant or payer history. Actual
operational registration/Root admission remains separate from PUBLIC QA.

The original durable BusinessEffects/current/dispatch/received/continuation
path fences each network dispatch and retains its exact response before late
current failure. A fresh authorized read can query again after a lost GET;
it never creates or pays again. A missing historical archive preserves
`409 NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE`. Revoked access cannot apply
funds. Completed records and immutable event claims survive cold reopen.

The separate `Order.NativePayment` stores exact atom strings and accepted
public archive claims, not legacy display-unit settlement/refund evidence.
Each claim binds the original product, Store, order, invoice, session, terms,
network, currency/unit, payer, operation and archive hashes. Refund recipient
is the original payer; payment recipient is the original approved recipient.
Ordering uses verified height/index/member/event, never hash order. Duplicate
coordinates, event claims, refund IDs, missing history, replacement claims,
over-refunds and cumulative rollback are rejected. Exact pending original hashes
and read-completeness remain visible alongside confirmed amounts; a pending
reference can disappear only when that same original has a canonical receipt.
Pending never authorizes retry or erases confirmed claims. Refund IDs remain the
original signed Pay refund IDs; Shop return IDs remain separate originals.

A timely first paid claim consumes only the original reservation once. A
cancelled or expired order retains the original financial observation with
`ReconciliationRequired`; it cannot silently consume stock or ship. Duplicate
reads do not repeat inventory effects or order events. Partial refunds update
only the financial remainder and preserve the current fulfillment/return state.
Full refunded financial state does not imply physical goods were received.

The existing seller fulfillment and return-receipt/restock methods accept a
qualified Native original payment separately from legacy evidence. Buyer
ownership, seller role, original return approval, line quantities and warehouse
evidence remain required. `ReceiveReturn` does not increase stock;
`RestockReturn` consumes its original goods receipt and idempotency key once.
Neither changes paid/refunded atom amounts or submits a money action.

Snapshot17 preserves the new optional payment projection. Cold opening requires
its original completed preparation and completed receipt-effect bytes; a lone
imported projection is refused. Existing orders migrate without fabricated
financial facts, and downgrade/export cannot discard protected payment history.

`TestP06OriginalPayShopDriver` is an opt-in test-only subprocess for P06's
original Core-proof/normal-HTTP/cold-Store journey. The staged protocol returns
Shop's actual randomly identified original order request, performs its normal
preparation before Pay archives terms/payment, then consumes the signed receipt
endpoint after the actual verifier has stored those originals. Received invoiceIntent
DATA is never imported as authority. PUBLIC Sources and temporary fixture
Members do not establish operational Root admission or real funds approval.
