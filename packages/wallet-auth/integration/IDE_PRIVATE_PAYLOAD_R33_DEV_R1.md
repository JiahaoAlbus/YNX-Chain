# R33 same-delivery private payload development contract R1

This successor is 1.3.0-pq.3.5 development. Frozen 3.4 is unchanged. Native R33
qualification, Source registration, the same publication/private Host instance
and real installed journeys remain unproved. Transport metadata grants nothing.

## Fixed SDK entry and the sole IDE framer

`acquireOriginalIDEPrivateServiceChannel(actualRunningEntryURL)` is the planned
fixed SDK entry, in original-ide-admission-parent-delivery.js. It privately uses
the exact original Native Node delivery retained by that module's earlier actual
acquisition. It never accepts a provider, parent object, source, path, FD or
callback. It derives Native R33 captureOriginalIDEPrivateClient once, retains its
partial before ready, and caches that exact same selection without reacquisition.
Call only AFTER installed validation and initial ACK complete. No new prelude.

It returns `{original, framer}`. `original` provides dispatch(raw), acknowledge
(operation,phase,requestId,responseDigest), selectCurrentOutcome and retirement/
join/close. It preserves one response object reference per original. Those methods
use the actual derived Native owner; no server terminal flag grants client ACK.

`framer` is a data transport facade, not another reader:

* `nextOutboundFrame(): Promise<string|null>` dequeues one canonical frame WITHOUT
  LF, once. null only means the retired writer has stopped. No frame replay.
* `assertCurrent(): void` checks the original derived owner; use before stream
  writes and after callbacks in addition to the IDE's existing epoch/lifecycle.
* `acceptInboundFrame(rawWithoutLF): void` consumes a complete frame from the ONE
  existing fd4 reader; it validates correlation and retains data before Native
  capture/current. It does not grant terminal ACK.
* `retireTransport(cause): void` retains the first failure and UNKNOWN, rejects
  pending callers and stops the writer. It never creates a replacement stream.

IDE keeps ownership of its current Socket, installed receiver and all ondata/
end/close/error hooks. It transitions that SAME reader after installed ACK to the
payload phase and starts one outbound loop. No SDK new Socket, duplicated reader,
send/subscribe callback installer or public original/provider setter is added.
Stop/drain/close the derived client BEFORE closing its original parent binding.
An uncertain client close keeps its debt; do not retry the parent's failed close.

## Wire frames

One canonical UTF-8 JSON value per LF. Initial installed/ACK framing stays at its
existing 65536-byte bound and never accepts business data before ready. Business
frame line bound is 589824 bytes (576 KiB); this only wraps escaped existing
262144-byte v3 input. The response frame bound is 196608 bytes (192 KiB); the
INNER original Native response remains at most 65536 bytes. Other pipes/signers
and the legacy/v3/v4 decoder budgets do not change.

Every frame has exactly these common fields:

`schema, type, bindingDigest, operation, phase, requestId, requestDigest`

schema is `YNX-IDE-PRIVATE-PAYLOAD/v1`. The three-field delivery binding digest is
SHA256(canonicalJSON({requestNonce,receiptDigest,consumerManifestDigest})), selected
from actual Native projections/current signed delivery on each side. It is only
correlation, not a capability. No path, Root, key or caller source is on the wire.
requestDigest is SHA256 of the exact original canonicalInput UTF-8 bytes.

* request: common fields plus `canonicalInput` (a STRING). The sole original SDK
  decoder supplies operation/phase/requestId; Native admission precedes forwarding.
* response: common fields plus `responseRaw,responseDigest`. responseRaw is exact
  canonical `{status,headers,body}`, including the original inner body string;
  responseDigest is SHA256(responseRaw). Do not rebuild a session/HTTP result.
* failure: common fields plus `errorCode`. Codes are bounded uppercase public
  codes. A peer failure never establishes NOT_APPLIED or clears UNKNOWN.

No separate business ACK frame is necessary on fd4: Parent Native client custody
and the derived child Native client custody are independent. Parent SDK handler
ACKs its own original actual Native joint after its own response/current checks.
Child acknowledge independently verifies its own Source-selected Host journal/
state via R33 Native terminal proof, only after R88's Native-window receipt.
Neither the daemon ACK nor parent receipt is the child ACK.

## Original Wallet-parent handler

The existing same-copy parent host facade will add
`handlePrivateServicePayload(rawFrame): Promise<string>` after its actual installed
ACK/once-adopt phase. App keeps its existing parent stream and extends that SAME
reader after ACK to call this method through its retained original parent source.
The SDK method uses only the same parent joint's actual executor.privateDispatch,
retains the original request/result, performs original Native terminal/current
checks, and returns a canonical response frame. It accepts no executor/provider.
Its pending tasks join the original parent's existing cleanup custody. No new
service socket, alternate Host or copied remote session is introduced.

## Failure and recovery

Malformed/cross-binding/duplicate/unknown frames, current/epoch loss, close/error,
uncertain writes or late result retain original bytes and first causes. No write
retry or resubmission of complete, signing or publication is allowed. Unsolicited
late data cannot revive a retired UI. Existing factory/recovery/coordinator still
must introspect current policy/revocation before connected. This contract does
not implement fresh-owner cold adoption or client-global UNKNOWN reconciliation.
