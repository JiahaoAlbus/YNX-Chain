# Actual original Auth Root ABI bridge

This module directly consumes the original Auth frozen **r3** C ABI. It does
not implement another Source, current verifier, Root, codec, grant, installer,
public provider table or runtime symbol guess. The Objective-C++ implementation
includes the original `browser_page_root_private_v3.h` from the exact supplied
immutable include tree. Its public-to-the-Native-composition header contains
only an owning class and its drain result; no opaque pointer constructor or
injected function accepts arbitrary caller authority.

Frozen original supplier:

```
/REDACTED_VOLUME/YNX-large-work/auth-owned-r258/browser-page-native-source-successor/successor-r3/frozen-r3/HANDOFF.json
SHA256 5a6a5ab748786b1f11346156a2cd8d729d45a85ad034f7cc7dbb7d463d24f6ae
```

Original root header SHA256 is
`652fe41bacba2c5e557828ec460c0ad0b845f7ccf980125a7df7433528485e29`.
Original root implementation SHA256 is
`a9ababa8ae23aabd9d018d28626e1221a05dc327332f9f02a99b4709db4b8969`.
R2 and component-r1 headers must be the exact dependencies pinned by that
handoff. Do not include mutable `successor-r3/source` in normal builds, copy the
common Source TUs over newer owner changes, use `dynamic_lookup`, or load an
arbitrary dylib by name. The original owner retains common-TU composition and
the whole matching original Auth build.

## Fixed Native API

`+[BrowserOriginalPageSourceRoot acquireOriginal]` calls
`ynx_browser_page_root_acquire_original_v3` directly. **Retain the returned
holder before interpreting `acquisitionStatus`**, including error plus actual
partial. `acquisitionStatus`, `firstStatus` and `ownsOriginalRoot` report
separate observed facts; none is an authorization flag.

`requireCurrent` directly executes the same original root's actual current.
`copyOriginalContext:` calls `YNXCopyOriginalBrowserPageRootContextV3` surrounded
by real current fences; it returns the original authenticated context DATA,
not request JSON. Caller output is unchanged on failure.
`copyOriginalReadDeadline:` calls the original read-deadline getter and returns
the same fixed CLOCK_MONOTONIC nanoseconds; it never starts a new five-second
window. Do not reserialize the context into an invented original request.
Original exact request bytes, preparation/profile and expected binding still
need the original protected giver.

`retireOriginal` prevents further current use and retains the original root.
`closeOriginal` calls original close and then original destroy only after actual
`completed==1`. Its `BrowserOriginalPageRootDrain` fields are:

- `firstStatus`: sticky first acquisition/current/close error, even after drain.
- `completed`: actual original root close observed complete (or no root existed).
- `destroyed`: original destroy observed successful and cleared the same handle.

`completed==0` or `destroyed==0` means keep the **same holder** and continue only
its explicit cleanup. Never recreate a Source, refresh a deadline, transfer a
new endpoint or replay a read to hide UNKNOWN. A failed acquisition can report
`{firstStatus:71,completed:1,destroyed:1}` after genuine physical cleanup;
that is not a Source success. Dropping an unclosed holder is fail-stop, matching
the original root's non-discardable Source-debt rule. Window/App code must retain
and explicitly drain it. The bridge serializes every C operation and destruction
on the same private mutex; no raw handle is published.

The original current may run full mathematical verification/I/O. This is not a
pure local LINK write fence. Normal embedded Auth composition must schedule its
actual synchronous calls appropriately; do not assume it is safe to block a
WebKit UI delegate or substitute a cached `current:true`.

## Build and normal composition

Compile `native/IPC/BrowserOriginalPageSourceRoot.mm` as Objective-C++17 + ARC,
with `-I <exact frozen-r3/source>`, `-I <exact frozen-r2/source>`,
`-I <exact component-r1/source>` and `-I native/IPC`. Link that object with
the original owner's **whole matching Auth component**, Foundation, Security
and libc++. Use the original owner canonical recipe and same existing runtime;
do not create a second Root/native runtime. Swift can import this exact header
with `-import-objc-header native/IPC/BrowserOriginalPageSourceRoot.h`; the new
`InteropProbe.swift` verifies the real ClangImporter API, not stub types.
This module does not change Package.swift or the parent's ordinary candidate.

Normal startup calls `acquireOriginal` before its endpoint offer. Failed
acquisition must close/destroy its partial and must not create a page listener,
start the embedded receiver or read DOM. On genuine success, the actual original
root/context and SAME deadline can be retained for the existing endpoint
channel. The original receiver/normal factory must independently supply the
registered **consumer** identity and original Expected/read-request metadata.
The signed scope's `peer` identifies the remote **Browser target**, not that
consumer; using it for both sides would confuse two identities. The receiver
must match the actual OS caller and same registered Browser instance/epoch.

P05 already implements the suspended anonymous page listener, immutable owner
adoption, native endpoint object transfer and reverse protected page transport.
The original Auth frozen r3 now actually implements the independent Source-v2
constructor/current and counted parent adapter. Its H still explicitly lacks
the protected SAME-namespace endpoint/Expected giver and final request capture
assembly. `ynx_browser_page_capture_original_v2` is still NOT_SUPPLIED. There is
no supplied production embedded receiver identifier, immutable receiver app
resource or consumer peer getter. These are remaining **owning CODE**, not a
macOS Developer ID excuse. Genuine reviewed Root rows/enrollment/current/resource
activation and installed product validation remain independent later gates.

## Only new verification

```sh
/usr/bin/python3 apps/browser/native/Tests/BrowserOriginalPageSourceRootTests/test-source-root.py \
  --auth-handoff /abs/exact/frozen-r3/HANDOFF.json \
  --output "$RUNNER_TEMP/ynx-browser-original-root-bridge"
```

This is a private-component CI command: it requires the original frozen source,
normal objects and their exact receipts. A generic checkout without those
inputs cannot truthfully run this gate; source-only CI must report the component
not supplied, not substitute a PUBLIC Source or mark the missing gate passed.
The supplied object cohort is arm64-only and is not relabeled x86_64.

The script validates the frozen handoff/production source/object hashes, reuses
the exact original strongly linked cohort, and compiles only the new bridge and
new probe. Ten new checks call the **actual** original zero-input constructor
with its unchanged production-empty rows: error+nonnull partial adoption,
original current refusal, unchanged context/deadline outputs, same-owner retire,
actual close/destroy independent from first error, no current revival, and an
idempotent closed holder. It does not rerun original Auth eleven, endpoint six
or mount twelve. The Swift import check is compile-only. No injected Root/math
or fake success is used. All output is external; only the owned probe process
may be killed/reaped on its bounded timeout. Keys/profile/network/GUI remain
unused, and Source/Root admission remain false. UNKNOWN cleanup under real
positive Source child debt is NOT_RUN; it cannot be manufactured by a fake ABI.
