# Pay r6 archived recovery successor

This is a separate complete nine-module successor. The eight r5 runtime files
already supplied to Main and its frozen packaging inputs remain unchanged.
Original Main may select this whole successor later; never replace selected
leaves inside its active r5 snapshot.

The existing packager now accepts `--r6` to deliver all nine modules together:
`node apps/pay/native/scripts/build-qa.mjs --r6 /absolute/new-output` (add
`--mac-app` for the existing SwiftUI client). The r5 default and prior packages
remain unchanged. A new output directory is mandatory. In an r6 App, the Shop
order tab uses the original order reference for invoice, payment/refund reviews,
receipt queries and explicit same-transaction reconciliation. It enters the
same original Main bridge; absent qualified Main/Source still refuses. No
intent creation, signature or submission is triggered by opening the tab.
The installer checks the complete signed App file inventory before and after
copy, including the nine runtime modules, original bridge and resources. An
unchanged executable or source-head label alone cannot pass a changed runtime.

Normal Main boot still imports `createNativePayMainEntry` and
`composeNativePayProductSource` with the original admitted namespace's factory
and recognizer. New DATA-only actions are:

- `recover-archive`: productId, sourceOrder, merchant, invoiceId, nativeHash.
- `reconcile-archive`: productId, sourceOrder, merchant, invoiceId.

The normal order continuation additionally accepts `order-invoice`,
`order-terms-review`, `order-pay-review` and `order-reconcile` with only
`productId:shop.order` and the original `sourceOrder`. `order-refund-review`
adds `refundId` and decimal `amountAtoms`; `order-receipt` adds `nativeHash`;
`order-broadcast-review` adds `kind` and the original Main `originalHash`.
`order-reconcile-operation` adds the retained `nativeHash` and explicitly
reconciles that original operation through the existing private Pay service.
It checks the original order, operation owner/kind/native and ABCI identities,
then rereads the bill and the matching independently verified compact receipt.
Pending terms may be reconciled before issuance; payment/refund require issued
terms. A terminal result cannot regress or change in the next read. A lost
response offers only original archive queries, with no automatic reconciliation
retry, new intent, Member dispatch, signature or replacement nonce.
`canRetry:false` does not permanently lock a retained hash against a later
explicit proof reconciliation. It supplies no retry permission and never
dispatches another action automatically. After a fresh original-order query
under a valid original Source/current still lists that same hash as `unknown`
or `submitted`, the user may explicitly request the same reconciliation again.
The original npi, invoice, session, kind, owner and native/ABCI identities must
remain bound; the normal consumer rechecks them. A failed query, absent or
changed original, retired Source or unconfirmed cleanup keeps recovery on
queries only. Terminal originals use their retained archive query. Keep only
an in-flight presentation guard; do not add a permanent attempted-hash ledger.
The CLI exposes the same names and positional fields. These actions reject
renderer-supplied merchant, invoice, grant or price overrides.

Each operation uses the same held Source/current to read the original Shop
11-field `NativeShopInvoiceRequestDATA` and look up the existing npi. It never
creates an intent implicitly. The lookup's merchant, invoice, session, network,
asset, amount and terms hashes bind the next original service read. An unsigned
terms review requires the normal service's `awaiting_merchant_approval` phase;
other PREPARED/UNKNOWN states remain recovery only. Main independently chooses
and checks its current account, network and nonce. Original review, separate
broadcast consent, journal, cancellation and UNKNOWN ownership remain there.
For PREPARED terms already holding an original native/ABCI hash pair, the
normal order query also reads the same original invoice and exposes its pending
operation. It never labels those terms paid: paid, refunded and net-paid must
remain zero until a fresh issued lookup. The terms operation must match the
original native hash, ABCI hash, kind and merchant. Unsigned terms do not invent
a hash or read a nonexistent invoice. UNKNOWN remains visible even when only
the intent can be read. Terms recovery offers the existing same-order
`lookup-intent`, without redirecting into payment/refund archives or automatic
reconciliation. A retained terms hash cannot request a new unsigned review.
Receipt/reconciliation DATA must additionally match that original session and
terms message hash. This does not supply a price approval, Auth grant or the
missing standalone Shop Native authenticated transport to Main.

`PAY_NATIVE_WORKFLOW_SUITE=original-order-client` runs the affected binding and
Main-result controls. `original-order` reopens the pinned retained PUBLIC Store
in three fresh processes through the original Main wrapper and normal HTTP,
including lost lookup, historical payment/refund proof reads and revocation.
`original-order-review` runs the original SDK and Main typed review producer for
terms, payer and refund via normal Pay handlers, publishing then cancelling
each original review once. Its setup imports two preexisting PUBLIC historical
Members/proofs; the review journey signs, approves and submits nothing. Exact
runtime, Main module hash, source root and fixture paths must be supplied to
the existing runner. Generic CI runs the r6 Node checks automatically.
`original-operation-recovery` runs the new recovery checks and actual normal
HTTP/Main workflow against the same fixed PUBLIC three-row Core proof fixture:
lost terms/payment/refund acknowledgements, four Store reopens, a lost reconcile
reply after durable proof archival, cold read-only receipt/reconciliation and
retirement. It also checks Source retirement immediately before intent crash
repair writes. The original installed Main wrapper and its exact hash are
required. This is controlled integration evidence, not genuine merchant payment.
`pending-terms-query` reuses the original PUBLIC terms Member/proof and normal
HTTP/Main wrapper for the narrow pending-display delta: lost original ACK,
temporarily unavailable independent proof, original hash query, explicit
reconciliation and cold confirmed-terms read with zero paid atoms. It does not
rerun the already verified full payment/refund workflow.

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

Normal Main cancellation now carries one operation-owned `AbortSignal` through
the business client and held ProductSource read. Cancelling invoice lookup,
payment review or refund review aborts that same pending original read before
it can enter Pay or Main signing; invalidated results retain no stale reference.
Source drain also survives throwing listener registration/removal: a possibly
installed listener is adopted before registration, active read debt is always
released, and a cleanup failure never replaces the first read/add failure.
Failed detach remains unsafe for reuse/safe-close, even if physical close finishes.
`main-source-cancellation.test.mjs` checks the normal entry against an actual
held HTTP recipient; optional pinned `PAY_MAIN_PRODUCT_MODULE` selects the
original installed outer wrapper for bounded acceptance. It supplies no session,
Root, invoice receipt or funds authority.

The `shop-session-link-joint` suite now joins the existing signed V2 proof,
owned same-socket LINK GET, normal Shop verifier/backend current, durable session
inventory/order ACL and this original Main consumer in one execution. It reads
the same retained eleven-field request after a cold reopen, rejects missing
proof/cross-tenant/revoked-session reads, and confirms the original order,
financial DATA and business nonces remain exact. The PUBLIC Root/native actor
seams and an explicit stop before Pay dispatch remain visible. The original
installed Main wrapper runs as a Node consumer; no new App or GUI is installed.

This suite explicitly accepts only existing session versions 2/3 (the current
fixture actually emits 2). It does not qualify a new DEVICE/session4. Session4
requires the original V4 exact GET PQ proof, matching carrier and original
registration/history/current/replay verifier. Its proof cannot be converted to
the V2 POST-introspection header, or accepted by increasing a header budget.
`testsupport/prepare_shop_session_joint.py` freezes the original Shop commit and
adds build-tagged PUBLIC observers only in the owned composition; it never edits
an owner checkout, installs Root rows, or adds a normal LINK export.

`shop-sdk-native-joint` selects the new fixed SDK wrapper plus the original
Native Owner/ProofLoan/NAPI translation units in the installed Node 24 runtime.
Its PUBLIC native ports supply only bounded original request DATA and an
explicitly unsigned proof fixture. The original Main wrapper enters P06's
normal lookup path and sole business validator, then stops at the absent Pay
capability. A second same-order lookup keeps the original SDK Promise; Main
cancel prevents its cached DATA from entering Pay and sends no second GET.
Native child closure and the separate PUBLIC parent closure are checked
independently. This suite neither qualifies session4 nor installs an image.
It requires explicit `PUBLIC_SHOP_SDK_MODULE`, `PUBLIC_SHOP_NATIVE_IMAGE`,
`PUBLIC_SHOP_EXPECTED_DATA`, `PAY_NODE_BINARY` and `PAY_MAIN_PRODUCT_MODULE`;
the SDK and Main source pins are checked before loading. Native fixture build
commands, exact inputs and the one permitted fixture-body replacement belong
in the corresponding owned build receipt, never in the installed application.
`shop-sdk-native-parent-progress` couples the later original Native pending-phase
fix to that same SDK wrapper. A known pending Source phase progresses on the
same child while the original failure remains exact; final physical completion
does not repeat session close, GET or proof acquisition. It checks only that
child's physical witness and never asserts whole ProductSource/Pay closure.

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

Normal Main result DATA is available through the optional Main-boot
`entry.invokeResult(request)` using the existing exact request shapes. Original
`entry.invoke(request)` still throws the identical original cause. Result DATA
uses `version:ynx.pay.main-result/v1` and an explicit `ok` field. On success the
existing bill, intent, operations, approval request and archive projections
remain flat. `pendingOriginals` and `outcomeUnknown` retain known pending
operation hashes beside the original decimal-string totals. `canRetry:false`
applies throughout; a successful read or approval request does not authorize
signing, submission or client finality.

Failures expose only bounded code, observed HTTP status when available, and
same-current original references. `outcome:UNKNOWN` does not assert a failed
payment. `recoveryActions` contains only the same original intent lookup/GET,
invoice GET or original archive read; it cannot offer create, approval, signing,
new quote or dispatch. The original ABCI `originalHash` is never relabelled as
`nativeHash`. Late Source/account invalidation strips failure references and
recovery actions. Busy/invalid requests cannot borrow another request's state.

Original P01 may select `{...entry,invoke:entry.invokeResult}` at its existing
normal Main boot caller; no extra renderer channel or input action is added.
The existing Main guard and publication of the same actual pending review
remain required. Check both the IPC envelope and result `ok`; neither is a
funds receipt. `readNativePayFailureCause(result)` is a Main-only diagnostic
read of a private weak association. It preserves even false/null/undefined
causes; structured-cloned renderer DATA has no association. Main reads this
before serialization if it records diagnostics. No stack, response body,
Member, envelope, credentials or original exception crosses into result DATA.

`PAY_NATIVE_WORKFLOW_SUITE=main-result-client` checks this new module with the
frozen original P01 product wrapper and the actual normal Go private factory /
HTTP / durable Store. Creation happens once, its response is lost, then a new
Node process and cold Go Store execute only the returned original lookup and
GET. Original disk bytes remain unchanged; actual Source denial stays503.
This delta performs no Core money POST or review/sign/dispatch and reuses the
existing five-original partial/full-refund evidence without rerunning it.
