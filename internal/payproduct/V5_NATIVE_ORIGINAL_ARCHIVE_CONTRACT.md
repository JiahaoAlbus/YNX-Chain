# Native Pay verified public originals

The normal `NativePayService.Reconcile` captures future original records only
after the existing independent Core H/H+1 transaction verifier succeeds. It
keeps the exact Member/envelope, original canonical terms, fixed invoice/order/
session/product-merchant binding, the Source-selected expected adjacent headers,
original proof bytes, public trusted light block, verifier result and exact
funds-event claim. Verification uses detached original bytes; the real held
engine snapshot remains a separate dependency and is never serialized into an
authority constructor.

The archive contains public historical verification DATA. It does not contain
private keys, payer Wallet journals, a fabricated signing review, current
account snapshots presented as historical ones, or an authorization grant.
A consumer needs its own genuine Source and independently supplied trust. The
recorded verifier result cannot admit Native, authorize another transaction or
supply another payer's private signing context.

The existing authenticated Store transaction appends a separate encrypted
`native.originals` BusinessDispatch record and its immutable digest reference
alongside the verified operation/effect, original event claim and original
outbox enqueue. Each original native hash has one archive slot; replacement is
refused. A failed durable write or outbox operation commits none of them.
Archives use the existing Store integrity envelope and atomic persistence, not
a second database or transaction journal. Per-record bounds preserve Core's
80 MiB proof limit plus 16 MiB of bounded original/anchor overhead; ordinary
invoice responses and other client calls retain their prior limits.

`NativePayService.ReadOriginalArchive(ctx,merchant,invoiceID,nativeHash)` and
`NativeInvoiceIntentClient.ReadOriginalArchive(ctx,merchant,invoiceID,nativeHash,current)`
read that same original without network/Core lookup, mutation, backfill or send.
The fixed normal private route is:

    GET /v5/pay/invoices/{merchant}/{invoice}/originals/{nativeHash}

There is no body, query, caller-selected URL, payer identity, approval or trust
input. Existing fresh exact-invoice read authority and its current fence apply.
The response is `NativePayOriginalArchive` DATA with a digest and explicit
public historical authority label. Original event/outbox identities stay on the
existing `/events` feed; an event is never a new funds receipt or send trigger.

Old confirmed journals and unresolved originals without archives continue to
return `409 NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE`; Source absence/revocation
is still `503 NATIVE_PAY_AUTHORITY_UNAVAILABLE`. Reconcile does not reconstruct
an old missing archive from current policy, another payer's journal or a newer
invoice snapshot. Error candidate operations are not durable UNKNOWN records;
only the original Store establishes an actual reserved original.

The original CI script selects `PAY_NATIVE_WORKFLOW_SUITE=native-archive` in a
prepared P06 normal composition. Supply the existing independently generated
Core temporary-chain fixture directory as its second argument, `GOFLAGS` for
the matching normal module file, and original Go/OpenSSL/cache paths. This runs
only the new archive workflow and old-missing-archive contract case. It reuses
existing actual BlockExecutor H/H+1 proof originals and tests the new normal
HTTP consumer, atomic persistence failure, same-op cold reads, two independent
normal server process restarts with Core offline, duplicate reconciliation and
original outbox identity, a second valid payment nonce, and concurrent refund
reservations exceeding the remaining principal. Source and temporary keys are
PUBLIC controls; the uncertain extra refund POST is deliberately unexecuted.
No real funds, real merchant approval, deployment or same-source App admission
is claimed. The delivered Main r5 eight client modules remain unchanged.
