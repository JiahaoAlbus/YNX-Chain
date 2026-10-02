# Authority runtime failure diagnostics

The Finance Go reader preserves the existing public status/error body, three
second CLI budget, four process slots, browser serialization, fresh HTTPS clock
sample, signature/expiry/checkpoint verification and strict result parsing.
There is no cached clock, retry, increased timeout or rollback relaxation.

A failed call now emits one `finance_authority_runtime` diagnostic with fixed
operation, phase, cause and child-exit enums plus queue/execution/total monotonic
elapsed milliseconds. Queue timing covers the process-slot wait after the
existing browser mutex; it does not claim to measure time waiting for that
mutex. Child exit is only `not_started`, `start_failed`, `success`, `degraded`,
`signal` or `other_nonzero`. No command arguments, file paths, request/response
text, root data, tokens, proofs, key material, account or private data is logged.
Success produces no diagnostic. A successful child whose result fails the
existing strict parser emits `STRICT_RESPONSE_INVALID` with its real elapsed
process metrics. Diagnostics cannot change the authority result.

For exit failures, a child cause is recognized only from a single bounded JSON
object with exactly the original runtime degraded-envelope fields, no duplicate
or unknown fields, correct schema/status and all three safety flags explicitly
false. Only the source-listed cause enums are emitted. Unknown strings become
`UNKNOWN_CAUSE`; malformed/trailing/missing fields become
`INVALID_FAILURE_SHAPE`. Oversize output and any stderr are identified with
fixed enums without forwarding their contents. Public errors remain the same
`FINANCE_AUTHORITY_V2_REJECTED`, `...INVALID_RESPONSE`, `...BUSY` or `...TIMEOUT`.

Optional `NodeEndpointAuthorityConfig.Diagnostic` receives the same bounded
metadata for embedded consumers and direct tests. The serving default uses the
existing Go standard logger. A diagnostic callback panic is isolated and cannot
turn an authority rejection into success.

The read-only production observation examined 731 existing journal records
from 07:55 to 11:15 UTC and found no typed authority events. The current reader
uses the same protected trusted-time file for browser and private calls. An
independent controlled source probe demonstrated fresh-clock response reordering
can produce `AUTHORITY_V2_CLOCK_ROLLBACK`; that is a candidate mechanism, not
proof of the intermittent public 503 cause. The diagnostic source must be
reviewed, built and compatibly published before a later genuine failure event
can establish its cause. Healthy responses do not close that issue.

Source tests execute the original Node CLI with isolated protected QA state,
controlled fresh HTTPS samples and synthetic signing keys. Clock rollback,
manifest expiry and invalid signature retain exit 3 and the exact original
failure envelope. Go tests execute real children for those envelopes, malformed,
unknown, duplicate, extra/trailing, oversize and stderr cases; queue/child timeout
and strict-result rejection are separately tested. They never read or change
production state, keys, clock/checkpoint or user sessions.

## Optional child phase pipe

A separately reviewed successor attaches an anonymous FD3 only on Linux/Darwin
and enables it through the serving process's fixed environment. The Node CLI
never writes diagnostics to stdout or stderr. It emits only the closed schema
`ynx-finance-authority-phase/v1`, a source allowlisted phase and an integer
monotonic elapsed time from Node process startup. The optional emitter writes
at most 24 records and 2048 total bytes; regular files, missing/closed FDs and
write failures disable it without changing the authority result. The anonymous
pipe's minimum capacity on the supported targets exceeds this finite write
budget, and Go reads it concurrently.

Go retains at most 4096 bytes, accepts only at most 24 newline-terminated records
of 256 bytes each, rejects duplicate/unknown fields, invalid UTF-8, non-integer,
negative, decreasing or over-60000ms times, and unknown phases. Invalid streams
are discarded, never copied into logs. A child/descendant cannot hold FD3 open
and delay collection indefinitely: after the original process finishes, the
collector waits at most 5ms then closes its read descriptor. Missing/truncated
metadata does not authorize anything or change public errors. The child context
remains exactly the existing three-second production budget.

A failed serving call adds a separate `finance_authority_phase` log with fixed
operation, last phase, monotonic child milliseconds and telemetry status
`not_started`, `unavailable`, `none`, `available` or `invalid`. Original runtime
failure logging remains unchanged. These are best-effort progress markers,
not a proof that the succeeding stage or business authorization completed.
`cli-ready` is emitted after static module imports. Clock fetch/body/persist,
checkpoint inspection, authority verification, history/anchor scan/verification
and final CLI completion are independently marked. A last `done` can distinguish
post-validation process-exit delay from earlier waits. No argument, file path,
root, signature, proof, token, key, account, error text or body is present.

One actual pre-successor serving event at 12:39:52 UTC was `browser-config`,
execution `TIMEOUT`, signal exit, zero queue wait and 3004ms execution/total.
This establishes that event's child deadline, not which Node stage consumed it.
The controlled rollback mechanism remains separate; lower-phase causality stays
undetermined until a genuine serving failure includes the new markers.
