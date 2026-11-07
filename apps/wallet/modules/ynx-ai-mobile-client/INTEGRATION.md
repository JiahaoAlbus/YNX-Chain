# Original AI mobile V6 native module

This module implements `YNXOriginalAIMobileV6` as an RN 0.86 CxxTurboModule.
It is thin C++/JNI/Objective-C++ source, not an independent Auth/Core/Go image.
Use the original execution policy at
`/Users/huangjiahao/Desktop/YNX Chain/docs/engineering/YNX_EXECUTION_POLICY.md`.
Do not attach this source to the old c6af image or another frozen candidate.

## Normal app entry

P01/P08 owners register their own normal app entry points; this module does not
edit either application. Android calls
`YNXOriginalAIMobileV6Registration.registerBeforeReactHost()` after A loads the
ONE selected combined native image and before constructing ReactHost. Its JNI
body chains the existing DefaultTurboModuleManagerDelegate Cxx provider and
claims only the fixed module name. It does not add a JavaScript install method,
setter, package name fallback or another System.loadLibrary call.

On iOS, call `YNXOriginalAIMobileV6RegisterBeforeReactHost()` before RN host
construction. It uses RN's actual `registerCxxModuleToGlobalModuleMap` API.

Before host invalidation, call the platform request-retire hook. This only
revokes/cancels. Run the drain hook on the original native teardown executor,
never the JS/AbortSignal thread. A false return retains that runtime and all
partial/UNKNOWN cleanup debt. Only a true actual-close/release result permits
retiring the native inventory. A successor runtime cannot take over retained
old-runtime resources.

## One matching runtime

`AUTH_HEADER_PINS.json` names the entire immutable matching Auth supplier.
Native includes its canonical headers directly; do not add copies of those
headers or the module's `native/auth`/`native/codec` directory to header search
paths. Native owns only the sole producer header, codec declarations and its
own binding/producer/transport implementations.

A supplies exact matching Auth source/inherited/native/core include roots and
all strong bodies once. Android CMake requires an existing A-selected combined
target plus those roots, adds OBJECT sources to that target, and imports no
Auth archive. The iOS pod has no vendored/static archive. Both P08 AI-only and
P01 PQ+AI require this same finite composition. The existing PQ static import
cannot also be imported into a second AI image. A has not supplied a final
installed-image path in this module.

Required suppliers include matching Auth C17/Source18/recovery/transport,
sole fixed35/16/E5/header/response DATA implementations, original OS application6,
original protected approval and dedicated V6 agent signer, actual LINK physical
TUs and its neutral bridge from the ONE original runtime. Missing strong bodies
fail final linkage. Empty real Root release rows refuse; no PUBLIC test seam is
part of the normal source set.

## Native custody and calls

The private surface follows r4 primitive intent snapshots plus r5 asynchronous
private cleanup. The SDK captures/validates a canonical primitive string before
Native context/request/approval allocation. Getter/Proxy traps can execute on
the SDK side; Native never inspects arbitrary intent objects. It accepts exact11
canonical keys and copies raw base64url body bytes (1MiB body, 16KiB metadata,
2MiB primitive carrier). DATA supplies no Root, peer, signer or approval.

Client/packet/context/review/operation/recovery brands are actual C++
HostObject classes with same-runtime/source/inventory/ancestry checks. C tokens
and transport/credential FDs never become JavaScript handles. Source capture is
zero-argument; actual C peer/context/Prepared inventory materializes on the
original serial OS actor. New contexts do not renew the held Source deadline.
The SDK's cancellation reduces that SAME context atomically.

Acquire/review/prove/send/query/cleanup use the actor asynchronously. Read,
readRecovery, ownerState and intrinsic predicates use bounded cached Native
facts. Busy actor reads refuse immediately; there is no future.get on JS behind
protected UI. Prove passes the same genuine review as C argument4.

Every nonnull C/physical/response partial is inventoried before failure presence
is inspected, including present=true/code=0. Original and close failures remain
separate. Native dispatch selects its same operation once, independently holds
Auth transport authority AND payload loan, and validates the sole original
header against the retained unsigned35/Member/body/nonce/operation/context.
Its LINK worker fence only checks atomic Native cancellation and Auth's fixed
monotonic worker-current observation; full Root/current calls stay on the actor.

Private Context1003 and Packet1004 expose cached ownerState, atomic
requestCancel and deduplicated Promise join/closeOwner. Packet cleanup progresses
physical/authority before and after closing Auth outcome/operation/review;
context cleanup waits for packet AND query children. This breaks the real
operation/transport dependency cycle without dropping debt. Active limits count
unclosed owners; historical closed brands remain recognizable. Closing a packet
releases its large cached bytes only after actual closure and forbids reopening
that packet. Cleanup creates no nonce, review, source or send.

## Original recovery and response

Recovery returns Auth readkind12's actual stored immutable index, <=16KiB.
Legacy/missing index throws ORIGINAL_EVIDENCE_NOT_SUPPLIED; raw original slots,
query owner and phase remain held. No envelope synthesis, migration/backfill,
phase-to-business promotion or UNKNOWN redispatch is allowed.

Native retains actual HTTP headers/body/partial packet and signed declaration.
Only a successful matching Auth outcome can publish its verified business
metadata and receipt. HTTP200, declaration.state and ordinary journal phase
cannot produce COMMITTED/ACCEPTED/OBSERVED on their own. The matching Auth successor first verifies server Root/full N1 and the exact
outer body commitment, then uses the sole signed-carrier decoder and original
kind4/kind5 getters. Native calls that same sole decoder only after successful
Auth outcome and byte-compares metadata/optional receipt against those genuine
getters. A missing receipt (10407) remains null; a present-empty receipt remains
a zero-length Uint8Array. The public Observation keeps request body, raw outer
HTTP body and response16 outer digest separate; inner business body stays in the
authenticated internal outcome. The matching whole Auth client/recovery handoff and fixed Unicode SDK carrier
are pinned together in RESPONSE_CARRIER_PINS.json; old untagged/HTTP-only input
is not upgraded.

## Verification boundaries

`test/ci.mjs` checks immutable supplier pins and runs the necessary worker and
actual RN/JSC controls on macOS. `run-bridge-controls.mjs ... transport` exercises
actual Native attempt/4-wrapper/response/HostObject bodies with clearly named
PUBLIC Auth+LINK ABI seams; it is not real Auth/TLS/Root proof.
`compile-platform.mjs` emits actual Android NDK and iOS simulator objects for all
normal Native TUs and both registrars and checks strong producer10/response6
symbols. Kotlin uses actual RN/fbjni AARs. These checks are not a mobile whole
image, package, installation, Root admission, real protected signing, TLS,
business completion or deployment. Reuse supplier controls; do not rerun their
old green suites as a substitute for current composed-response checks.

The current non-PUBLIC normal composition combines 23 actual Native/Auth/sole/LINK
TUs into a relocatable object. This proves internal owning-symbol resolution,
not a final executable. REQUIRED_EXTERNAL_STRONG_IMPORTS in the composition
evidence is authoritative for the remaining Core18/N1, original directory/SHA,
App6, protected approval7, dedicated agent7 and neutral TLS6 gates. Root/A and
the original SDK/Wallet platform owners supply these actual bodies. Reuse the
original PQ directory/SHA pure Native objects, the single original Core archive
and original LINK neutral TLS library; do not add another archive/runtime or
replace a missing body with a PUBLIC/provider fallback.
