# Mobile PQ custody bridge

Owned write set: this directory only. Follow
`/Users/huangjiahao/Desktop/YNX Chain/docs/engineering/YNX_EXECUTION_POLICY.md`.
Original Auth owns the required producer and platform encrypted-backup decoder;
Protocol owns the maintained fixed ML-DSA-87 AND SLH-DSA-SHA2-256f implementation;
original A owns formal Native/App builds. No package, UI, lockfile, desktop dirty
file or production provider is changed here.

`index.ts` selects a real native held operation by original reference DATA and
one mode: `transaction`, `registered-restore`, or `original-query`. That string
is a lookup constraint, never review, approval, Source or account authority.
The original Auth capture must resolve its own held review/Source, selected
account/network/vault epoch/nonce/message/budget/deadline. Missing actual
qualification refuses. The module has no JS/native provider setter.

`native/ProtectedMobilePQ.h` is NEW required private Auth producer ABI, proposed
and handed to the original Auth owner. It is not an existing matching69 getter.
`CustodyABI.h` consumes ordinary matching69 custody and requires one NEW exact
owner-binding check from Auth. That new check is implemented in Auth's fixed
`custody-binding/evidence/binding-04ZLDB` handoff (SHA256
`f779efe3efb7a44ab137c7f590fc57d8c36086d18b18fb2aceeed99f95f5a723`),
with actual Darwin object and PUBLIC controls. Its platform scope does not
establish Android/iOS admission. Declaration compatibility was checked against
that exact header; neither declaration supplies the missing mobile bodies.
The fixed strong linker dependencies prevent a build from silently substituting
a JS signer, classic key, empty provider or birth factory. Android's decoder
and both platforms' protected source/slot producer still need their original
owner's same-version implementation and matching archive.

The native worker owns partial captures, borrowed credential loans, the exact
ordinary custody ID, retained signed bytes and first submission/query snapshot.
Every native custody call uses one dedicated OS thread. A GCD serial queue is
not assumed to preserve pthread identity. `prepare` captures no private keys;
`signOnce` checks genuine sign authority, borrows existing encrypted backup and
EXACT43 credential inside native only, opens purpose1, verifies the opened
binding, executes the fixed ordinary once primitive, captures its outcome and
requires original journal ACK. The borrowed loan is released before signing.
Before the primitive, Auth's strong `begin_sign_once` must durably ACK the
original `SIGN_ENTERED` marker AND the same opened binding/review/nonce. An
in-memory flag or repeated current check is insufficient. A lost marker ACK
must not call crypto; another capture of that reference cannot sign again.
Failure or late lock keeps the original, never re-signs.
Unconfirmed signed-original storage blocks capture release and close even after
private buffers are wiped. `saveOriginal` can flush only those SAME retained
native bytes to the original journal, preserving the first cause; no signing or
dispatch is called. Auth's closed gate likewise refuses unresolved IO/query ACK.

`submitSignedOnce` independently checks broadcast authority, durably enters the
original UNKNOWN slot before one authenticated dispatch, and captures the
first retained response before late current checks. A begin lost ACK cannot be
retried. `queryOriginal` never sends a Member or creates an operation. It keeps
the first query snapshot separately from the submission. Repeated query returns
that original snapshot; it does not claim fresh status or finality. Cold query
mode reads the original account-owned durable entered marker from Auth.
Its flags distinguish sign-entered, signed-ACK, submit-entered, restore-entered
and restored-ACK. Cold sign uncertainty can only read its original local/service
state; missing hash never triggers a broadcast or a replacement signature.

`restoreRegisteredEmptyOnce` is ordinary backup restoration, not account birth.
The Auth producer must verify actual registered public binding against the
SAME opened ordinary owner, check current slot epoch and CAS an EMPTY original
protected slot. An occupied slot refuses; no overwrite, new key, registration
or public-chain operation is available. Current after successful restore checks
the exact restored terminal slot, instead of demanding it remain empty.

Hermes receives only detached fixed public metadata, phase/code/flags and
digests. No signed Member/envelope, raw response, backup, credential, owner ID,
pointer, DER, entropy or secret crosses JSI/JNI/Swift UI. Those native originals
remain retained for original journal/dispatch and are not reusable UI packets.
There is no Node SDK import in the Hermes client.

`cancel` closes new effects but keeps same-owner original query custody.
`retire` ends the capture; `join` is a worker queue fence, not proof of closure.
`close` retains first/cleanup cause and uses actual `release_closed` gates even
when close returns an original sticky failure. Unclosed resources stay in the
native inventory; GC never closes, resubmits, fabricates ACK or discards debt.
App invalidation suppresses queued effects, drains native owners off the JS
thread, and retains the worker if drain is incomplete. Public outcomes do not
grant retry, clearing or finality.
The original App quit/background coordinator must examine `close().closed`
before destroying its RN runtime. `invalidate` is a last retention barrier,
not permission to close the App over a failed save or unresolved native debt.
Promise resolve/reject functions remain in the JS runtime's own Map. Only
completion IDs and fixed public metadata reach the worker/JS invoker; no JSI
function/value is destroyed on the custody thread after runtime teardown.

## Integration and verification

Android uses the real ReactContext runtime/CallInvoker getters, JNI and the
module's single native worker. iOS uses RN's
`RCTTurboModuleWithJSIBindings` runtime/callInvoker hook plus a Swift lifecycle
wrapper. Original Main must register the package/pod and normal boot hook in
its own write set. Adding this directory alone does not install a module.
The Android CMake requires `YNX_AUTH_MOBILE_ARCHIVE` from original A and refuses
missing/unresolved symbols. Supply ONE matching archive, never a second Go
runtime. iOS final target must likewise strong-link original Auth/Core.

Run new native controls with `node test/run-native-controls.mjs`.
Parent's ordinary CI should call `node test/ci.mjs <normal-react-native-root>`
for this module's closed checks; it requires the actual matching RN0.86 tree.
No parent package/CI file is modified by this owned module. Parent integration
is required so this script is not mistaken for an already wired CI job.
PUBLIC C stand-ins are test files only and excluded from all production source
lists. ASAN/UBSAN controls exercise actual engine, pthread worker, once and
failure handling. Apple ASAN lacks LeakSanitizer; live PUBLIC capture/loan/owner
counts are checked explicitly and no leak-sanitizer coverage is claimed.
The Hermes client controls use actual TypeScript transpilation with a PUBLIC
native-installer seam; they establish no Native qualification or real crypto.
JSI/JNI syntax checks must use actual matching RN/fbjni headers, not fake headers.
Platform archive linking, Android/iOS App launch, OS secure store, real Auth
approval, registered restore, signing, dispatch and chain finality are separate
acceptance gates and are not established by host controls or declarations.
