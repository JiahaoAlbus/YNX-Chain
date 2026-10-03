# Quant HTTP shutdown storage drain

Parent ordinary-source checkpoint: bce759c7e6a09e62ba17328eca7c835cb65d6222.
Owned paths: apps/quant-lab/server only, plus this evidence.

Previously ListenAndServe could return ErrServerClosed while a separate Shutdown
goroutine was still draining requests. Main then returned and closed tenant
storage. The server now synchronously joins Shutdown and admitted business
handlers. Signal context is propagated as HTTP BaseContext. On grace expiry,
connections are closed, but admitted handlers are still joined before storage
can close. A mutex-protected admission barrier rejects late business calls with
503 and prevents WaitGroup Add/Wait races. Listener/server errors return through
normal defers rather than bypassing worker/storage cleanup with log.Fatal.

Actual loopback HTTP tests exercise the real server helper: cooperative drain;
grace-expired handler remaining blocked; cancellation reaching request context;
helper refusing to return until handler release; and late admission rejection.
No mock Wallet account, signature or transaction is involved.

Validation: go test -race ./apps/quant-lab/server ./internal/quantlab; go vet on
both packages; gofmt and git diff --check. This is local lifecycle evidence,
not installed OS signal, public deployment or database restart evidence. The
previous checkpoint's isolated PostgreSQL 20/116 results do not count as new
public proof here. No persistence schema or shared authority changed.

Safety boundary: a noncooperative handler can delay safe exit beyond the grace
window; this deliberately does not close a database still in use. Hijacked
connections are not used by this product and are not claimed covered. Abrupt
process termination cannot run normal defers. Formal release integration remains
with the unique release owner; public/installed/Wallet/Product Session gates
remain unverified by this checkpoint.
