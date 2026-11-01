# Pay r6 archived recovery successor

This is a separate complete nine-module successor. The eight r5 runtime files
already supplied to Main and its frozen packaging inputs remain unchanged.
Original Main may select this whole successor later; never replace selected
leaves inside its active r5 snapshot.

Normal Main boot still imports `createNativePayMainEntry` and
`composeNativePayProductSource` with the original admitted namespace's factory
and recognizer. New DATA-only actions are:

- `recover-archive`: productId, sourceOrder, merchant, invoiceId, nativeHash.
- `reconcile-archive`: productId, sourceOrder, merchant, invoiceId.

Both first reread the original product request from the held ProductSource.
Its original qualified `readOriginalArchiveReceipt(ref,current)` or
`readOriginalArchiveReconciliation(ref,current)` supplies the receipt. The
consumer also has a concrete fallback to these methods on the existing private
Pay client; no new callback is required to make the normal service usable.
The existing current/selection checks, active-call drain, cancellation and
UNKNOWN-close custody apply to these ports. Missing ports refuse only these
actions. Renderer input, JSON, a public fixture recognizer, a receipt boolean
or Wallet Member5 scope cannot provide a Native Source or independent trust.

The normal service and existing Go `NativeInvoiceIntentClient` share the same
receipt and reconciliation implementation:

    ReadOriginalArchiveReceipt(ctx, originalRequest, invoiceID, nativeHash,
                               actualIndependentProofSource, current)
    ReadOriginalArchiveReconciliation(ctx, originalRequest, invoiceID,
                                      actualIndependentProofSource, current)

The original product request and independent proof Source come from the actual
held provider. The Go reader uses the existing original-intent and raw-archive
GETs. The normal service additionally resolves its own existing stored product
intent and exposes compact read projections through fixed GETs:

    /v5/pay/products/{product}/{order}/invoices/{merchant}/{invoice}/originals/{hash}/receipt
    /v5/pay/products/{product}/{order}/invoices/{merchant}/{invoice}/archive-reconciliation

The r6 private Pay client uses these exact routes without a body, query, new
transport, URL override or retry. They pass both original product Source/current
and native invoice read authority; the service rechecks before release. Actual
normal boot mounts the product handlers alongside existing intent handlers. The typed
reader verifies exact product/order/merchant/invoice/hash/terms bindings and
reuses the original Core H/H+1 verifier, detached-input fence and canonical
effect decoder. Archive-supplied anchors/results cannot replace independent
trust. No current policy or another payer's private signing journal is read.

Compact receipts show historical operation facts. Merchant reconciliation sums
one original successful payment and cumulative original refunds in execution
order, retains unresolved original hashes and rereads the original invoice to
reject concurrent changes. `completeKnownOriginals` refers only to that exact
original Pay journal, not global current balance or unknown external activity.
Missing history or a cumulative mismatch fails closed. The source-owned Go
reader verifies the proof; the JavaScript successor checks safe DATA bindings
and displays its compact result without duplicating a crypto/receipt codec.

The summary preserves `dataOnly:true`, `queryOnly:true`, `canRetry:false`,
`SourceAdmission:false`, `nativeGrant:false` and `clientIndependentFinality:false`.
It exposes no raw Member, proof, private signing context or grant. Existing
Wallet review/signing remains with original Main. Missing old archives preserve
409; missing/revoked Source preserves503. These new exact read routes still require
the real ProductSource profile; Wallet Member5 is not widened. A lost read response repeats only the
same original query in a cold client. Legacy invoice recovery now performs GET
only and asks for original product references before archive recovery; it does
not reconcile or send a POST implicitly. Existing other review operations stay
on the original Main path.

The CLI additionally accepts `recover-archive PRODUCT ORDER MERCHANT INVOICE HASH`
and `reconcile-archive PRODUCT ORDER MERCHANT INVOICE` through the existing
explicit original-runtime entry. It constructs no authority itself.

`PAY_NATIVE_WORKFLOW_SUITE=r6-archive` runs only five new client controls and the
new actual consumer→Go typed reader→normal HTTP/Store cold-start case. It reuses
the existing actual Core fixture, with explicit PUBLIC Source/temporary Member
setup. The direct normal private-client/HTTP projection is tested in addition
to the initial Go typed-reader consumption. Recovery runs with Core offline, an actual lost GET response, original
Store bytes unchanged, wrong independent anchor refusal,409/503 and zero
POST. The resulting original-bound compact reconciliation is supplied as Shop
consumable DATA. No real Root, merchant signing, App install, deployment or
funds acceptance is claimed. Old webhook and unrelated green groups are reused.

The normal Main producer may construct `createPrivateNativeProductPayClient`
from its original Auth-selected `{origin,requestPrivate}` resource. This fixed
13-method facade exposes preparation/read/reconciliation only; signed Member
POSTs and packet/raw transport methods remain with the original Wallet path.
Main's `createMainProductPeerPayProducer` owns that resource's lifecycle. There
is no extra Pay namespace wrapper or public provider installation. The consumer
forwards caller cancellation, retains in-flight reads until drain, and reserves
join/close promises before invoking original ports. Failed/UNKNOWN cleanup is
never retried. `PAY_NATIVE_WORKFLOW_SUITE=r6-private-client` checks these new
custody cases and exact paths against Auth's compiled archive DATA contract;
it neither repeats the archive E2E suite nor admits a Root/Source.

Refund receipt details now retain the original Core effect's `refundId`,
`payer`, `recipient`, `assetId` and `unitVersion`, plus independently verified
`executionHeight`, `executionIndex`, `executionMember` and `executionEvent`.
Reconciliation follows those coordinates and refuses duplicate coordinates or
refund IDs. Transaction hashes cannot order two actions in the same block.
Old compact DATA without details remains readable; a new detailed projection
must be complete. A refund ID is the original signed refund's identity, not a
new Shop return ID or permission to perform another refund.

The normal private listener uses LINK's Product-specific exact-route server.
Only the two fixed archive GETs accept canonical `%3A` inside the original order
or invoice identifiers. Double encoding, lowercase escape aliases, encoded
slashes, extra queries and arbitrary escaped routes remain refused. The generic
listener and Wallet's Member5 transport keep their original policy. Actual
Unix reception is checked separately from HTTP proof/Store/Shop acceptance.

`refund-receipt` selects the detail/order controls and related normal archive
regression. `shop-refund-journey` drives the original Shop test subprocess against
the real staged Pay service: merchant terms and payment are archived first;
only after the original paid order and return flow does the temporary original
refund get archived. Shop rereads Pay, cold-opens its own Store and checks that
partial refund, duplicate receipts and warehouse operations remain independent.
These tests use explicit PUBLIC Source/temporary Member fixtures, not genuine
Root commissioning or real-funds approval.
