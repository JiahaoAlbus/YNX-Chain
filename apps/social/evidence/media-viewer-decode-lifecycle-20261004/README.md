# Actual media viewer callback and recovery checks

Base source: 513d2c87f5921e5a89391be5c8fec2966a0e495f.
Controller: 01a094cc-0ba3-7901-bcd5-56fce8330c0d.

## Original observed defect

The actual NativeMatrixMediaViewer component was bundled and mounted in a local
controlled React DOM host. The original component opened Original-1.png, then
retried Original-2.png. Delivering the FIRST image's retained onError callback
removed the SECOND image and displayed its decode-error message. original-red-ax
and original-red.png retain the actual observed state, not a source-only claim.

The host substitutes React Native visual controls, AppState, authority and media
ports. Image is a controlled DOM placeholder: no native image decoder, plaintext
file, remote Matrix event, private identity or accepted contact is supplied.
Existing host React/ReactDOM are 19.0.0; owner React is 19.2.3. This deliberate
controlled host is NOT the matching installed/native runtime. No dependency,
lockfile, native SDK or shared graph was changed or downloaded.

## Product repair

BoundMediaPresentation now owns its imageDecodeFailed state. A functional updater
marks only the exact presentation that produced the callback. Old errors cannot
mark a later retry, including when room, event, lease and URI are identical; they
also cannot clear a current error. A fresh binding has no decode failure. Close,
background and scope transitions still hide the original presentation.

This changes presentation state only, not ciphertext, protocol, authority,
download permission, filesystem paths, SDK contracts or message history.

## Actual controlled UI observations

- Open then retry: new original preview is shown.
- Deliver old image error after retry: new preview remains, unlike original red.
- Deliver CURRENT image error: expected error text appears and image hides.
- Retry current error: a fresh preview appears.
- Deliver controlled AppState background: preview hides and lock message appears.
- Open, then fail controlled native release and close: preview is hidden, error
  explains cleanup remains pending, and the viewer does not falsely close.
- Recover controlled native release, retry close: Viewer closed appears.
- Reopen and explicitly open: a fresh normal preview appears.

Each transition has retained AX text; representative original/repaired/final PNGs
are retained. Interval captured warn/error logs were empty. This is not a claim
of all-runtime console0 or actual OS lifecycle/file deletion.

## Checks and preparation failures retained

Related nativeMatrix/receivedAttachment/nativeMedia tests: 58 PASS, 0 FAIL.
Full owner Social typecheck after correcting evidence archival: exit 0.
Isolated current-source web build: exit 0.
Controlled repaired host build: exit 0.

The first host build incorrectly aliased React to index.js rather than its package
directory; its original error log is retained. The corrected controlled host uses
the existing React matching the existing DOM renderer, without changing product
dependencies. The first owner typecheck also saw generated evidence entry.tsx
and a missing react-dom declaration; that log is retained. Host source copies
are now plain .tsx.txt evidence, not shipped TypeScript. No product tsconfig,
type check, test, feature or diagnostic was disabled. The root-relative git archive
attempt from the Social subdirectory failed; its preparation failure and exact
root-relative retry are recorded. Original failures are not relabeled PASS.

Only our tab 16 was closed. Only our exact local server command received SIGTERM;
the original server session completed exit 143. No inherited browser tab, device,
service, account, key or APK was touched.

## Outstanding real acceptance

Installed/native SDK event and file decode, actual OS background/unmount, original
protected producer and cleanup failure readback, peer/session/revoke checks,
public source-bound deployment and actual MONSTER acceptance remain NOT_VERIFIED.
Root must coordinate original native/A integration and existing device authority.
No account request, signature, EIP712, transaction, deployment or core activation
occurred. The aa975 deployment carrier was not rewritten to claim this later
source repair. Whole Social/crypto649 remains NOT_COMPLETE.
