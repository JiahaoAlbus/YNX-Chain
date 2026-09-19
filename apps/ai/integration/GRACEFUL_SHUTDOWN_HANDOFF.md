# AI graceful shutdown successor

This source succeeds the 9e9117d5 chat candidate and retains all its fixes.
Preserve prior build stages and receipts; rebuild both binaries from the
exact successor commit reported to the release coordinator. Do not relabel
an existing 9e or 2c archive as this release.

## Runtime behavior

Both entrypoints use internal/aigateway/httpdrain. SIGTERM and SIGINT start
draining, reject newly dispatched requests, close the listener and idle
connections, and wait for active HTTP handlers to return. Main does not
return merely because Serve reports ErrServerClosed.

The timeout defaults to 60 seconds per process. Optional settings:

- YNX_AI_CLIENT_SHUTDOWN_TIMEOUT
- YNX_AI_GATEWAY_SHUTDOWN_TIMEOUT

On deadline expiry, request contexts are cancelled, active connections are
closed, and the error reaches main for a nonzero exit. This is a forced
termination outcome, not proof that every business operation persisted.
Normal shutdown waits for handlers; their existing persistence errors remain
HTTP errors, not swallowed by the lifecycle helper. No background flush is
substituted for the store's synchronous save contract.

## Sole release-owner procedure

Keep the assistant-host admission gate and shared Caddy edits with release.
Drain the client while the Gateway remains available, then drain the Gateway.
Ensure each unit's effective TimeoutStopSec exceeds its application deadline
with margin (for example 75 seconds for the 60-second application default).
Do not send SIGKILL earlier and then claim application drain succeeded.

The old running binary does not gain graceful shutdown retroactively.
The first upgrade still needs the release owner's external admission gate
and evidence that existing client work has finished. Gateway active=0 alone
does not prove there are no client-side writes or persistence operations.

Capture exit status and drain logs, preserve current state and all keys, and
perform the existing private-copy cold-load and source-bound public checks.
Do not restore a stale pre-drain snapshot over newly completed writes.
An abnormal exit requires investigation and preservation of current state,
not an automatic assertion that rollback is lossless.

## Evidence and limits

Local tests launch a real subprocess with a TCP HTTP server, hold an HTTP
request in flight, send actual SIGTERM, and check new admission rejection.
The successful path completes the response and writes a disk marker before
process exit. The deadline path observes request-context cancellation and a
nonzero exit, without a completed response. These are not mock Shutdown tests.

On 2026-09-19, httpdrain, aigateway and aiproduct tests passed; both main
packages compiled; frontend tests passed 47/47. The existing store regression
separately covers persistence failure rollback, encrypted restart and account
isolation. This does not replace installed Linux unit drain evidence or real
authenticated default/BYOK chat acceptance. No deployment was performed here.
