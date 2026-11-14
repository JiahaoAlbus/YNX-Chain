# PUBLIC embedded NSXPC process probe

This is a headless macOS14+ / arm64 transport and local selected-page lifetime
test. It uses Foundation `NSXPCListener.service()` in a real embedded service and
`NSXPCConnection(serviceName:)` in a real CLI `Host.app`. No GUI, LaunchAgent,
public socket, Tor/Nym, network request, TLS override or system proxy is used.

From the repository root, supply a **new** managed scratch directory:

```sh
/usr/bin/python3 apps/browser/native-ipc-tests/run-public-ipc.py "$RUNNER_TEMP/ynx-public-page-ipc"
```

All binaries, app bundles, signatures, immutable source snapshots, command logs,
runtime receipts and PUBLIC bodies are written there. Only a new ASCII symlink
is placed under `/private/tmp`; it is retained with the receipt. Builds are
sequential. Optional `--reuse-core <previous-scratch>` reuses a previous Core
dylib/module only after checking every current Core source hash against that
snapshot. It never reuses stale Native/transport/probe inputs.

The test packages independently ad-hoc-signed service bundles inside the signed
host, then performs `codesign --verify --deep --strict`. The service's fixture
delegate derives the code hash from the actual sealed host executable and takes
PID/UID from the actual OS `NSXPCConnection`, before constructing the production
`BrowserPageIPCPeer`. Wrong-peer and wrong-code fixtures deliberately select a
mismatching PID/hash. No payload PID, approval bit, portable E5 framing, Auth
Root or Source registration is accepted. This fixture peer selection is **not**
a production authority factory or a substitute for original Auth qualification.

Ten real process cases cover three original selected pages, wrong peer,
wrong code, request/response byte caps, simultaneous-call busy rejection,
connection cancellation while a real Core borrow is held, navigation/clear
revocation during extraction, and abrupt service exit/connection loss. Native
calls the exact production transport; the PUBLIC owner calls actual Core
`borrowSelectedPages` / `borrow.read` / batch encoding. Its sealed Info selects
a PUBLIC scenario and a test-only file signal triggers navigation, clear,
continuation, abrupt exit, or normal shutdown. Those signals are not sent in
the production request and add no portable protocol or product permissions.

Requests use existing `YNX_AI_BROWSER_PAGE_READ_REQUEST_V1` selection DATA;
responses use existing `YNX_BROWSER_SELECTED_PAGE_READOUT_V1` and exact original
snapshot envelopes. The fixture does not qualify the request's session/task
or bind the AI task ID to the local preparation as real Auth must do. Every
receipt therefore keeps Root/Auth qualification **NOT_RUN**.

`RESULT.json` reports actual runtime outcomes. Nine normal service shutdowns
must write `closed=true, active=0` and exit; the deliberately abrupt `_exit(73)`
case must only prove loss and process disappearance, **not** graceful owner
close. The host never signals discovered service PIDs. Fixture shutdown signals
request their own owner cleanup; PID0 probes only observe disappearance.
Failure paths preserve the first cause and request the same known owners close.

`verify-readback.py <existing-scratch>` can independently inspect already
collected evidence without launching anything. It verifies exact reference
order, bytes, SHA3-512/SHA-512 and envelope metadata for both actual three-page
readouts; rejected calls have no body/owner entry, and borrowed-call defers
released their original handles. It runs automatically after a successful host
run. New CI may invoke the one command above; no old Browser/Tor matrices need
to run for this module.

The first v1 harness run compiled/sealed but trapped: a service resumed its
special listener from a MainActor block (nested `dispatch_main`), and the host's
ObjC error block inherited MainActor isolation. v2 uses the synchronous special
service entry and an explicitly Sendable error block. Original crash reports
and v1 logs are preserved. A compile or signature check alone is never runtime
PASS. Production Auth factory/registration, installed Browser IPC composition,
signed NE qualification and protected end-to-end user use remain separate.

## Native producer consumer delta

```sh
/usr/bin/python3 apps/browser/native-ipc-tests/run-public-ipc.py "$RUNNER_TEMP/ynx-public-page-consumer" --consumer-delta
```

This selects `ConsumerIPCProbe.swift`, snapshots the actual Native
`BrowserNativePageReadoutProducer.swift` plus current Core request parser, and
runs only four **new** process cases. It does not run the ten transport cases.
Changed Core inputs require a fresh Core build; the reuse option refuses hash
mismatch. The same real embedded NSXPC transport is used.

The PUBLIC owner invokes the actual Native producer, not a fixture-only schema
check. Its ExpectedData has independent constant run/session/account/task/
revision/generation/holder operands and references obtained from the actual
original selections before receiving a request. A fixture-only sealed scenario
selects independently fixed unknown-reference or unowned-profile operands;
nothing from request DATA is copied into expected authority. This comparison
fixture is explicitly **not** an Auth Source, Root, Grant or production factory.

Cases are full P08 request to three original pages; seven wrong session/task/
revision/generation/run/unknown-ref/profile subcases with zero extraction; real
navigation plus Native producer close while a borrow is suspended, returning
no body; and pre-retired first page returning STALE without a snapshot while
the other two remain AVAILABLE. The latter preserves every original reference,
tab/profile/generation/origin/field/length/hash metadata value. The request
contains `runId` and the actual P08 session subset; a generation of
9007199254740993 exercises exact UInt64 transport instead of a floating-point
round trip. The selected-document generation is a separate value.

`verify-consumer-readback.py <existing-consumer-scratch>` independently checks
the stored requests, metadata and SHA3/SHA512 readouts, all seven zero-DOM
rejections, suspended-borrow release, and four normal zero-active owner closes.
It is run automatically by the consumer command and does not start processes.
Root/Auth qualification, actual signed Source/current/revocation, normal
Browser-to-Auth runtime installation and real user egress remain NOT_RUN.
