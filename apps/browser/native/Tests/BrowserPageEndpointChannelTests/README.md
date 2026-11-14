# Private native endpoint handoff delta

`BrowserOriginalPageEndpointChannel` transfers an actual
`NSXPCListenerEndpoint` over an application-scoped embedded XPC connection.
The private Objective-C selector is declared in
`native/IPC/BrowserOriginalPageEndpointIPC.h`. Foundation's SDK
`NSXPCConnection.h` explicitly supports sending this native object over an
existing NSXPC connection. There is no JSON, URL, manual archive, file, socket,
environment value, global Mach service or portable endpoint representation.

This is **transport custody**, not original Source acquisition. An empty
transfer reply only acknowledges delivery. The module cannot create an Auth
owner, original metadata, Root, Grant or `BrowserOriginalPageSourceMount.Acquisition`.
It does not install a production receiver or choose an Auth service identifier.

Run only the new delta from the repository root, with a fresh external output:

```sh
/usr/bin/python3 apps/browser/native/Tests/BrowserPageEndpointChannelTests/test-endpoint-channel.py --output "$RUNNER_TEMP/ynx-browser-endpoint-new6"
```

The driver compiles real BaseIPC, mount and endpoint channel plus its PUBLIC
fixture for host and service, creates a private ad-hoc-signed fixture `.app`
with actual embedded XPC services, and checks the bundle signatures. No user
signing identity, privileged install, GUI, network or existing application is
used. Actual service PID comes from the fixture warmup's OS connection solely
for these PUBLIC tests; this is NOT a production identity registration.

Six new process cases exercise native endpoint transfer with zero reads while
the page listener is suspended, the actual reverse P05 page RPC after mount
activation, one-shot replay rejection, cancellation before transfer, mismatching
real peer, cancellation with a late reply, connection loss, and original-current
loss. Configuration rejects a code-requirement mismatch before connecting.
Only the normal synthetic case reads one PUBLIC body. Failed/cancelled offers
must never activate the page listener or release a body. All shutdown is for
owned fixture processes; discovered service PIDs are observed, never signalled.
The old 14 process tests are not run. Auth/Root qualification remains NOT_RUN.

## Normal startup integration and remaining original-owner code

The original Auth source component must supply the receiver and independently
registered consumer peer. As observed in frozen
`auth-owned-r258/browser-page-native-source-successor/successor-r2/frozen-r2`,
`ynx_browser_page_capture_original_v2` still returns NOT_SUPPLIED/null. The
transport constructor `initWithOriginalEndpoint:process:user:identifier:
codeDirectoryHash:originalRequest:monotonicDeadline:` exists, but consumes an
already-held endpoint; it cannot obtain one from P08 request DATA.

The subsequently observed `successor-r3/source/browser_page_source_private.h`
adds actual original-owner methods such as
`acquireOriginalBrowserSelectedPagesSource:` and
`assertOriginalBrowserSelectedPagesCurrent:`. The newly added
`browser_page_root_private_v3.h` and `browser_page_root_v3.mm` now implement
`ynx_browser_page_root_acquire_original_v3`, its current/retire/close/destroy,
`borrow_parent_v3`, and `YNXCopyOriginalBrowserPageRootContextV3`. This is a real
zero-input Source constructor/current implementation, not merely a design.
Its default release-row list is empty. That WIP has no supplied frozen component
delivery/endpoint receiver, and r2's request capture remains NOT_SUPPLIED. A
nonnull failed Root must be adopted and actually drained/destroyed using the
same original ABI; never discarded. None of that original source is rewritten
here. Original SDK owns its normal Browser Source dispatcher.

The parent normal composition's fixed sequence is:

1. Obtain the genuine independently held original bootstrap/current reference
   and registered **consumer** PID/UID/code from original Auth. This must exist
   before a Source borrow that itself needs the endpoint; no self-locking
   `Source.current` predicate is invented by this module. If that original
   getter is unavailable, do not launch or offer an endpoint. Auth's actual v3
   Root/current API is the newly available CODE seam for this step once its
   original owner supplies the frozen matching component and genuine resources;
   no `_silgen_name`, guessed library/symbol or locally copied Source is added.
2. Validate the actual embedded Auth `.xpc` using
   `BrowserEmbeddedPageEndpointService(application:identifier:
   codeDirectoryHash:peer:)`; create its suspended connection with
   `makeConnection()`. No service name/peer comes from request DATA. There is no
   fallback to a public service or another process.
3. Create and retain the existing one-shot `BrowserOriginalPageSourceMount`.
   Its internal original-acquisition callback receives the still-suspended page
   listener endpoint. Construct a channel with the private connection, the
   registered consumer peer, the genuine current callback, and a teardown
   callback that synchronously calls this actual mount's `invalidate()`.
   Retain the same channel while original acquisition and its cleanup are live.
4. Call `transfer(endpoint)` once. The receiver only retains the native object
   and checks the actual Browser caller and independent registered incarnation;
   it must not wait for a page read while mount is suspended. Original Auth must
   independently qualify its original Root/profile/task/request/epoch, construct
   its transport child from this held endpoint, and return its actual native
   owner/allowed-consumer peer through mount's existing Acquisition. Empty
   transfer completion alone cannot supply that result.
5. Mount alone resumes the page listener after actual successful acquisition
   and real current checks. Original Auth's **Browser target** code/instance
   binding and Browser listener's allowed **consumer** binding are different
   identities and must both hold. A same code hash or payload PID is insufficient.
6. Window/App close, source loss or cancellation synchronously invalidates the
   actual mount and channel before awaiting cleanup. Await `channel.close()`
   and `mount.close()`. Channel completion requires actual NSXPC invalidation;
   timeout retains the same connection as closeUnknown. Mount separately retains
   a failed/partial original owner for explicit same-owner close retry. No
   reacquisition, new endpoint, scope replacement or request replay follows
   UNKNOWN.

Actual receiver integration, normal registered consumer peer/endpoint capture,
and original Source registration remain original Auth owning CODE. The observed
v3 Source/Root/current CODE must still arrive as an original-owner matching
build; it is no longer described as unwritten. Independent Root material and
activation are distinct gates. The tests do not
claim normal startup, installed original Source, genuine P08 comparison or global
revocation atomicity.
