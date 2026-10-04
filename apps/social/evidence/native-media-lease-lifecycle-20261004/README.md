# Native received-media lease lifecycle repair

Base source: aa975f91a2b62953b9c51ba47318ce4003209b8c.
Base tree: bc04dc4192b758f5b939efa2e43205e6fb86e3e3.
Controller: original continuation audit thread 01a094cc-0ba3-7901-bcd5-56fce8330c0d.

## Original failures retained

Four new deterministic probes invoke the actual MatrixMediaPreview implementation
using a controlled media port and authority-await barrier. All four failed on the
unchanged original source; original-red.txt is retained without rewriting it:

- Producer mutation changed the filename, size and file URI during the second
  authority await, so the displayed snapshot no longer described the original DTO.
- Retirement during that await released a mutated lease ID instead of the original.
- Two overlapping close paths issued two native releases of the same handle.
- Overlapping failed closes likewise issued duplicate releases instead of sharing
  the failure and preserving one original cleanup obligation for retry.

## Owned implementation change

nativeMatrixMedia.ts now captures a detached frozen DTO immediately after the native
open result, before awaiting the existing current-and-accepted authority again.
The producer object itself is not frozen or modified. Existing room/event, URI,
type, size, epoch and accepted-peer checks remain. Display and retired cleanup
use that captured DTO, not a later producer mutation.

A per-handle in-flight release map coalesces overlapping calls. Only successful
release removes the pending cleanup handle. Rejection removes the in-flight entry
but leaves the original pending handle, permitting an explicit later retry. No
timeout, synthetic success, discarded cleanup or replacement native downloader
was introduced. Existing hiding-before-await behavior is preserved.

The actual viewer has separate background, unmount and explicit-close callbacks;
the component-level tests reproduce overlapping controller calls, not actual OS
lifecycle events. No viewer, native module or shared producer was modified.

## Validation and limits

Related nativeMatrix tests plus receivedAttachmentState: 48 PASS, 0 FAIL.
Full Social tsc --noEmit: exit 0.
Isolated current-source web build with the two changed source files: exit 0.
Product dist, existing APKs, accounts, keys, drafts and caches are untouched.

These results are controlled component/source evidence. They are not installed
plaintext/media acceptance, native SDK or filesystem-release proof, private
session/contact permission proof, actual background/unmount UI validation, a
public deployment, or MONSTER acceptance. Actual private-media UI is NOT_RUN:
it requires the original matching admitted native producer, installed source and
an authorized existing device window. The old emulator reservation has expired
and is not reused. Root must route that integration through the existing native
owner; no fixture identity or account/sign/transaction request is substituted.

The previous aa975 web carrier remains a separate exact candidate; this later
consumer repair is not silently claimed inside its frozen bytes. No deployment
or new crypto activation has occurred. Full Social/crypto649 remains NOT_COMPLETE.
