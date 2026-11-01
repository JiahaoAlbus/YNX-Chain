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

The normal startup composition must acquire the original Root's independently
verified transport resource before constructing the client. The original
binding and query mode constrain that resource; they cannot select a socket,
service, peer identity, or registration. P06's fixed route constraints are
intersected with that original resource. The actual Main retirement epoch is
retained separately and cannot be synthesized from the transport profile.

The startup owner and the exported registration borrow have separate custody.
The SourceLease constructor adopts a nonnull borrow into a nonnull Source
partial even when it reports a later error. Adopt that Source partial before
checking the error. A constructor returning no Source must leave the borrow
with the startup owner. Neither branch may repeat the constructor, release an
already transferred borrow, or treat an unknown transfer as a failed transfer.

The normal owner must remain reachable through native drain. Retiring it
cancels its registration; the actual Source and channel children then drain
and return their original borrows before the owner joins and closes the
registration. Dropping a registration borrow alone does not close its Go
parent or release the parent's cgo handle. The normal Native composition must
own that final cleanup as well as the SourceLease's borrow.

`OpenNativeLocalCallerStartup` combines the real client construction,
registration, and initial borrow for a normal Go owner. Its nonnull owner is
adopted before its error. `TransferBorrowToNativeSource` runs the normal
Go/native bridge's exact Auth constructor once, outside owner and registration
locks. Its opaque output records custody only. A panic leaves transfer custody
UNKNOWN, retains the original owner and borrow, and prevents another transfer
or release. `FirstCause` remains diagnostic data when a partial later drains.
Concurrent joins share one context-bounded registration wait and wake every
waiting caller after actual drain. If that wait is cancelled, another live
caller can continue draining without extending the cancelled caller's context.

This Go startup owner does not define a Native entry accepting configuration.
Auth supplies the genuine pre-Source resource getter and actual-context
constructor; the strong private startup entry below consumes those originals.
The actual normal Native capture and matching complete image remain separate
integration requirements before normal startup is complete.

## Strong Native startup entry

`private_client_startup_v1.h` declares eight private entries. They are compiled
only with `securelink_pay_native_startup` and CGO on a supported Unix platform.
Ordinary Go builds do not acquire unresolved Auth dependencies. The normal
archive uses strong Auth symbols and has no weak provider or fixture installer.

`ynx_link_pay_native_startup_open_v1` accepts only an actual
`ynx_wallet_pay_actual_context_v1*`, minted by Auth's native owner. That context
already fixes the genuine operational Root, same Main epoch, binding, query
mode, and internally captured original transport loan. LINK obtains that exact
loan and native fences through Auth's strong getters. No second loan, config,
binding, Main pointer, callback, or replacement resource can be supplied.

The bounded copied profile preserves Auth's version, struct size, original
UID/PID, explicit time and response limits, and five fixed slots. Disabled raw
slots may still contain their registered strings; their Go bindings remain
entirely zero. An enabled GET has its exact zero-byte request budget. The
general private client/server route validator therefore permits zero only for
GET; POST still requires a positive budget. Limits are not increased to fit a
consumer's larger receive bound.

After actual NewClient/Register/Borrow, `adopt_source_v1` calls only Auth's
strong `ynx_wallet_pay_source_adopt_registration_v1` with the context retained
by open. It executes the existing one-shot Go transfer and preserves a nonnull
Source partial before the native status. The Source's original native fence
still runs independently at the actual request write.

The Native owner first retires its actual context and children, then drains
and closes the channel and drops the original SourceLease. The startup's Join
cannot complete until that Source has returned the registration borrow.
Startup Close closes its own Go parent and releases its retained Root/context
fence borrows; only then does closed report physical completion. Concurrent
close attempts cannot report completion while the releases are in progress.
The original Native owner closes the actual context and its Root loan after
that drain. LINK never closes or retires those borrowed parents.

## Building and checking the normal archive

For the complete Wallet common image, use the combined builder described below.
`build-startup.mjs` builds the transport-only component; it does not contain
Core's transaction, account, artifact or product exports.

`cmd/ynx-secure-link-private-client/build-startup.mjs` accepts a SHA256-pinned
build-only header manifest and a new output directory outside the source tree.
The manifest is `{version:1,headers:[{name,path,bytes,sha256},...]}` and contains
Auth's original transport header, actual-context header and SourceLease C
header. The builder copies verified headers, builds the same-runtime archive,
checks its eight startup definitions and strong Root dependencies, and records
source fingerprints, exact commands, symbols and artifact hash. It preserves
failed outputs and refuses to replace a prior directory. This manifest cannot
register a runtime Root or endpoint.

The new archive already contains the original fourteen private-client exports.
Use it in place of the older archive; do not link two archives containing Go
runtimes into the normal image. Auth/SDK's normal image must resolve the strong
Root/context/Source constructor symbols using its matching original objects.
An archive with unresolved Auth dependencies is a component, not that complete
image or Root admission.

The original caller runner's `private-client-startup` selector runs the new
startup-specific Node/C++ control. It requires
`YNX_LINK_PAY_STARTUP_BUILD_RECEIPT` and its `_SHA256` value. The control verifies
the normal archive and formal Auth source pins, then links the actual context,
Root loan, SourceLease and Go code to a real owned Unix endpoint. Its explicit
PUBLIC Root/profile boundary does not establish crypto, Root, Main approval,
installation or deployment. Existing transport and packet controls remain
separate evidence.

## Single Core and LINK runtime

`cmd/ynx-secure-link-private-client/build-combined.mjs` materializes a new source
tree from the pinned original Core supply and LINK commit. Core's four package
closures, twelve handwritten headers, root module/sum and original sole
`core.go` main are copied unchanged. Replacement-module metadata is copied from
the same Core Git commit. The builder neither removes the original replacement
or tool directive nor invents a substitute module. Only the selected C ABI and
LINK dependency graph is built; this is not a build of the complete Chain tool.

One additional `link_transport_import.go` imports the fixed securelink package.
The old LINK carrier's main function is not copied, and Go files or C preambles
are not concatenated. One CGO-enabled `go build -buildmode=c-archive` therefore
produces one runtime containing the supplied complete Core ABI and twenty-two
LINK exports. The macOS 13 successor requires the new frozen fifteen-export
Core supply, including `YNXAccountMigrationPossessionSignV1`, for thirty-seven
strong exports in total. The earlier fourteen-export supplier and archive
remain separate immutable candidates. Signing algorithms and original
Root/caller authority checks remain owned by their existing implementations.

The output keeps the normal `libynx_artifact_release.a` filename and supplies
the complete Core/LINK/Auth headers plus Go's generated main export header.
It replaces both former standalone archives. Do not combine the old libraries
with `ar`/`libtool`, link a second Go archive, or allow owned weak/unresolved
symbols in the final Native image.

The builder records exact source origins and fingerprints, one build command,
toolchain, external cache location, archive hash and symbol result. The symbol
checker derives Core declarations from their original Go `//export` leaves and
C headers, requires the full LINK ABI, maps the actual Native undefined-symbol
evidence, and checks a single Go object/runtime entry. An undefined reference
inside an archive member may resolve to another member's strong definition;
the final normal image must resolve all owned symbols with its actual Native
objects. Neither symbol check establishes Root admission.

The combined builder now requires `--macos-deployment-target 13.0`. It resolves
the installed Xcode SDK without inheriting `SDKROOT`, sets
`MACOSX_DEPLOYMENT_TARGET`, and passes the same minimum version and SDK to cgo's
C, C++ and link flags. Its private Go cache, Go temporary files and native
temporary files remain under the new output directory. It preserves the
original Core/LINK source pins, one build invocation and existing ABI check.
The deployment checker additionally reads every archive member's actual Mach-O
load commands and rejects an object above the target, an unexpected CPU or a
missing/ambiguous macOS minimum version. It never edits load commands. Both
checks and the explicit toolchain/environment are retained in the receipt.

This is an archive build target, not an old-system runtime result. The final
Native image, Node executable and all dynamic libraries have independent
minimum versions and must be checked by their original owner. Loading on the
current host does not verify execution on macOS 13. Keep the earlier archive
and its observed 27.2 object targets intact; a rebuild is a separate candidate.

The original caller runner's `combined-archive` selector takes pinned functional
inputs through `YNX_COMBINED_FUNCTIONAL_INPUTS`, its `_SHA256`, and a new external
`YNX_COMBINED_FUNCTIONAL_OUTPUT` directory. The narrow probe uses existing public
N=1 valid/corrupt inputs and LINK refusal/drain in the same combined runtime.
Actual empty-Root refusal is reported only when the genuine Native Root module
is linked and executed; a null transport context is not a substitute. No key
generation, signing, account enrollment or deployment is implied.

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
