# Native private caller holder

The private C ABI is `cmd/ynx-secure-link-caller/private_client_v1.h`. It carries
opaque transport handles in the same process and Go runtime as the original
`LocalCallerClient`. It is not a Root/Source factory, SDK provider, signing
approval or payment receipt. P06 owns the five Pay request builders and its
`QualifiedPayChannel`; Auth/P01 own the genuine Native Source and its current
lease. Naming a channel Qualified does not establish those qualifications.

## Original Go registration and native borrow

The normal Go owner constructs the actual fixed `LocalCallerClient` from its
independently selected original registration, then calls:

```go
registration, err := securelink.RegisterNativeLocalCallerClient(
    originalParentContext, actualClient, indexedBindings)
```

`indexedBindings` is `[5]securelink.NativeLocalCallerBinding`, with immutable
`Method`, `Path` and `ContentType`. Enabled entries must be the actual client's
already registered exact routes. An unused slot is explicitly zero and denied;
it cannot select another route. The operation domain is fixed:

| Index | Operation | Method |
| --- | --- | --- |
| 0 | post_terms | POST |
| 1 | post_settlement | POST |
| 2 | post_refund | POST |
| 3 | get_intent | GET |
| 4 | get_invoice | GET |

POST uses the registered JSON MIME. GET has no request MIME or body. A query
borrow rejects all POST slots. A selected settlement/refund does not need a
fabricated intent ID merely to populate five slots. The original Source and
P06 binding checks independently constrain which enabled operation belongs to
the original action.

The original Go owner calls
`registration.BorrowNativeRegistrationPointer()` to export a real private
`ynx_link_private_client_registration_borrow_v1*`. This is a C allocation with
private ownership, not a raw Go object pointer, numeric token, JSON constructor
or cross-process protocol. The original Native SourceLease stores that borrow
in its private immutable state. Its original Source owner releases it after
the actual native children have drained.

Native code checks the borrow and obtains its original registration view with
`ynx_link_private_client_registration_from_borrow_v1`. The corresponding
`registration_borrow_current_v1` and `registration_borrow_release_v1` never
register another destination. The borrow prevents the original registration
from being freed and its address reused for another client. Parent retirement
invalidates the original registration and its context; it does not silently
replace the client or discard outstanding native borrows.

`NativeRegistrationPointer()` is only a temporary view while the Go owner
itself retains the registration. It is not the long-lived Native SourceLease
handoff. A pointer from a separate Pay Go daemon cannot be passed into Node's
Native addon. The normal Main/addon must embed this Go runtime and actually run
its normal registration factory from its actual Source-owned resource getter.
An empty library main and PUBLIC fixture registration do not satisfy that
normal startup requirement.

## Actual Native Source fence

Native capture takes the original registration, an actual Source fence, query
mode and an out-holder. The fence contains an opaque native context plus
`current`, `retain` and `release` functions. These functions must belong to the
genuine Auth/P01 native child, be thread safe and never invoke JS, perform
network/FD I/O, throw across C or reenter the Go holder. A callback returning
success does not by itself establish Source qualification.

Successful retain acquires one actual native borrow. A failed retain acquires
none. Capture adopts a nonnull partial holder before interpreting an error;
cleanup must preserve that partial and its first native failure. The holder
does not reconstruct a Source from Binding DATA or a returned HTTP packet.

`current_local_v1` checks observed native lifecycle only. `current_source_v1`
and `recheck_v1` additionally invoke the original native current fence. The
Go call independently invokes that same fence immediately before its actual
request write, after current fixed OS peer checks. A refusal at that point
reports no dispatch. A failure after writing cannot prove non-execution.

## Original response and uncertainty

Call accepts only the original holder, a registered operation index and owned
request bytes. It has no per-call URL, path, identity header, UID, PID, service,
Root selection or retry policy. One original POST attempt consumes the holder's
write attempt. A query uses only its independently admitted original read path.

A nonnull output packet is owned even when Call reports an error. Adopt it
first. `packet_present` distinguishes an actual parsed response from an error
without response. Method and request path come from the actual Go request;
P06 must compare them rather than relabel a response with an expected path.
Status, all parsed header values, original Content-Type/Cache-Control and the
received body prefix/full body survive late read or cancellation errors.
`header_json` encodes the original `http.Header` name-to-string-array map; it
does not claim to preserve raw HTTP header casing or wire order.

The packet also retains the original error, native current code, dispatch
uncertainty and observed partial-byte count. It is not an owned SDK
`error.partial`, authorization, COMMITTED result or finality proof. Preserve the
original operation as UNKNOWN until its real original query recovers a result.
Nothing automatically retries a POST, changes its Member or invents a query.

## Drain and cleanup

Retire prevents new work and cancels the actual child context. Join waits for
the real in-flight work. Its timeout is 1 through 60,000 ms; zero returns BOUNDS
immediately and never means drained. Run normal Join in its native async worker.
A finalizer must retire and preserve an owner for normal drain rather than
block implicitly or free an active Source.

An early Close that fails its known Join/work precondition releases nothing.
After real Join completes, the first actual Close/Free may finish; the earlier
Draining diagnostic remains available and is not relabeled as a past success.
An actual unknown cleanup failure must retain the original owner instead of
repeating its side effect. Free succeeds only after actual Join and Close and
releases the retained native Source borrow exactly once. A packet has its own
free function and cannot release a holder or parent registration.

All handles are private same-process objects. Getter callers must retain their
original native borrow until the getter returns. A freed pointer cannot be
reused as a capability. The holder never unlinks a Unix endpoint, closes its
borrowed Go client/parent, clears history or replaces an uncertain operation.

## Verification boundary

The production C symbols contain no fixture installer. PUBLIC fixture exports
exist only under the explicit `securelink_private_client_fixture` build tag.
Actual Unix/C++ controls prove framing, fixed-route dispatch, write-time
current, response retention and drain. They do not prove genuine Root/Source
admission, Main approval, production Native intake, installation or payment.
