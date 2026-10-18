# Original IDE private service pipe development contract R1

Development contract only. Not a Source registration, release approval, supplied
Native listener, package selection or installed admission. SDK20/r6a acquisition
and cleanup ABI remain unchanged. No endpoint, path, descriptor, provider, Root,
key or authorization callback may be supplied by the renderer or its envelope.

## Existing normal transport and ownership

Reuse IDE main.m originalServiceDispatch -> inherited stdin parent control ->
code-server native-parent-control. Preserve id/document/instance/projectId/workspace
and the exact canonicalInput string. IDE owns these pipe ends and UI retirement.
SDK owns its single decoder, original dispatcher/Host/journal and terminal ACK.
Auth owns the actual Source/current/child-qualified Native channel acquisition.

The current fixed unavailable branch is a pre-entry refusal. It is not the normal
success supplier. A successful development branch must use a fixed original SDK
acquisition and actual Native owner; a caller-supplied object or DTO cannot install
that supplier. Its exact acquisition callee is still awaiting Auth's independent
successor. Existing Node delivery (descriptor/assertCurrent/close) is not a private
service owner. Do not add arbitrary acquisition arguments to make it one.

## Canonical request and response

Use decodeOriginalWalletServicePrivateRequest unchanged as the only parser:

* Legacy has requestId/operation/phase/body/proofHeader (five fields).
* PQ v3 additionally has carrierVersion (six fields).
* Reference v4 additionally has carrierVersion/referenceAction (seven fields).
  Actions: beginYNX/challenge; handleReturn/complete; handleReturn/outcome.
* v4: envelope 65536 bytes, body 49152 bytes, response 65536 bytes.
  Other versions retain the existing decoder's purpose-specific limits.

The response is the exact canonical JSON string of {status,headers,body}; retain
its original body string, x-request-id and SHA256. Do not reconstruct it from a
session/result DTO. Envelope metadata locates/matches an original; it grants no
Source, account or Native custody authority.

## Original terminal ordering

The original owning SDK backend must execute this sequence before releasing a
successful normal response to the IDE transport:

1. Actual Source/current/child admission; retain exact request and first cause.
2. Original dispatcher.dispatch(raw), original Host and immutable entered record.
3. Owning journal.prepare before candidate snapshot persistence; commit/readback.
4. Original dispatcher.acknowledge(op,phase,requestId,resultDigest), which calls the
   actual Native terminal callee with its same retained original owner.
5. Recheck current and original result/terminal; only then publish exact response.

Here release means resolution of the renderer's Promise. IDE may first deliver a
provisional exact response privately to its actual Native parent over the existing
pipe/result directory. Its matching current document/epoch receipt can trigger
step 4 using the backend's retained row. It is only a transport receipt; do not
resolve the renderer until the SDK terminal ACK and post-current checks finish.
dispatch currently returns a response object, not a string; the owning SDK's
canonicalJSON(response) supplies outer resultRaw without rebuilding inner body.
acknowledge is synchronous and returns undefined; awaiting it is compatible.

After ACK, and before/after asynchronous private result publication, call the
same acquired dispatcher's selectCurrentOutcome(operation,phase,requestId).
It performs the actual original current fences before and after reading the row.
Require the identical retained result, terminal:true and unknown:false. A failing
fence preserves the result and first cause and marks the original row/Host UNKNOWN.
selectOutcome is historical custody inspection only, including after retirement;
it must not authorize success publication or stand in for a current check.

Operation/phase/requestId/digest are selected from the backend's original row.
Do not expose a renderer-controlled terminal ACK or use renderer success as proof.
An IDE parent delivery receipt may match the same local envelope; it cannot replace
step 4 or assert that the human received the result. No additional business action
or socket is introduced by this ordering.

Cancellation, timeout, page retirement, late current refusal, partial acquisition,
ACK refusal and uncertain IO retain their original input/result/first failure and
cleanup debt. They cannot retry complete, create a new bridge or clear UNKNOWN.
The current client-wide latch remains until a separately implemented fixed original
custody reconciliation path proves its exact record resolved. A completed DTO or
a terminal metadata flag does not provide that path.

## Recovery boundaries still incomplete

R30 Native getter is readOriginalNativePrivateServiceTerminalResult(original,
operation,phase,originalRequestId). Its ten-field result is data, not a capability.
v1 requires exact late response bytes. v2 retains exact original response bytes in
the same 8192-byte immutable terminal. Neither proves fresh account-policy/current
introspection or grants connected status.

AdmissionPrivate can register a qualified exact input without an effect. This alone
does not prove a past attempt. Restart recovery still requires original request
recovery, actual immutable journal verification, same-original Host adoption,
Native proof and original ACK/cleanup handling. Missing/partial originals stay
UNKNOWN. Current IDE memory rows are not a durable request journal. Do not relabel
live-handle recovery as restart recovery or dispatch complete again to register it.

## Delivery gates

Auth's listener successor must only borrow the actual already registered listener
resource for its current service PID; no socket/bind/listen creation or arbitrary
FD input. That resource and its lawful Source registration remain external gates.
The SDK normal daemon pump and IDE success branch await that exact formal callee.
R30 compact codec is independently consumable once its formal H is supplied.
Development source/control results do not establish those gates or an installation.
