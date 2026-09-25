# Finance Endpoint Authority race-closure candidate

This follows the Finance source-only local v2 cross-service checkpoint. It
does not repin the immutable release verifier manifest or claim public runtime.

The durable checkpoint marker is written before the IndexedDB transaction
commits. A denied marker write aborts the transaction. A later IndexedDB write
failure leaves the marker in place, so loss of the durable record fails closed
instead of falling back to an older server anchor. An unchanged checkpoint
does not broadcast a false invalidation.

Finance tracks actual signed checkpoint identity separately from explicit
page/session invalidation. Parallel reads of one unchanged identity can
complete; a genuine same-tab or cross-tab checkpoint advance raises the
revision observed by private actions. A hard invalidation cannot be undone by
an older in-flight read. A PENDING successor denies private authority while
Standard Wallet remains a separate path.

Focused browser regressions: 7/7 Endpoint Authority cases, including same-tab
PENDING successor, cross-tab invalidation, concurrent unchanged reads, marker
write denial and durable write denial; real local browser/Gateway/Finance Go
protected-route test 1/1; Go Finance package tests passed. No production
authority, actual Wallet approval, installed flow, public source binding,
payment, Broker execution, or chain transaction is inferred.
