# Original local caller owned exchange

`(*LocalCallerClient).CallOriginalOwned(ctx, method, path, contentType, body,
expected)` returns `(*OriginalLocalCallerExchange, LocalCallerResponse, error)`.
It uses the existing client's immutable Unix destination, service and finite
route registration for one connection and one HTTP attempt. The ordinary
`Call` and its existing private C ABI remain separate, unchanged contracts.

Adopt every nonnil exchange and original response before examining the error.
The exchange retains the original socket and process/image custody. It never
exposes a descriptor, destination setter, Source provider or approval callback.
HTTP DATA and kernel observations do not supply business authority.

## Independently selected server expectation

`LocalCallerExpectedProcess` is registration DATA from the original consumer's
independent reviewed server record. It must not be populated from the running
peer, the caller's process, or the service row's allowed-caller identity.

- `UID` and `PID` identify the server and must equal the client configuration.
- `StartKind=LocalCallerDarwinProcessStart` uses `StartA` seconds and `StartB`
  microseconds from the kernel process start time.
- `StartKind=LocalCallerLinuxProcessStart` uses `StartA` start ticks from the
  kernel's process stat record; `StartB` is zero.
- `ImagePath` is the independently selected absolute executable path.
  `ImageBytes` and the 32-byte `ImageSHA256` are mandatory. The current image
  size bound is 128 MiB.

The implementation anchors process/image custody before connecting, binds it
to the same socket's actual kernel peer, and checks it before dispatch and
after reading. Darwin requires Cgo for its real audit-token/libproc/mapped-vnode
observations; the no-Cgo path refuses that capability. Linux uses held process
and executable originals. These are finite observations, not an exec freeze,
memory attestation, Root approval or Source verifier.

## Complete response and current checks

`Current(ctx)` checks this original exchange's connection/process/image
continuity within its original lifetime. Before dispatch the peer check is
strict. After a complete HTTP response, normal terminal EOF can preserve the
original DATA. That state explicitly has no fresh liveness proof.
`Lifetime().Peer` reports the observed facts separately. A process/image
failure still rejects use and retains received DATA as private custody.

The original Auth full Source/current, epoch, account, role, order and session
checks remain independent requirements. They must run at the consumer's
original boundaries. Neither successful HTTP nor a physical-close witness
approves an invoice, payment, Source or session.

## Physical cleanup

Use the same exchange throughout `Retire`, `Join(ctx)`, `Close`, and
`AssertOriginalClosed`. Retire cancels original work; Join waits for that call
and its cancellation callback. Close selects socket/process/image cleanup
once. First operation error and physical completion are independent: a known
operation failure may remain after actual closure. Preserve that error while
still attempting the owned cleanup steps.

Only `AssertOriginalClosed()==nil` proves this exact exchange's owned resources
have completed physical closure. It accepts no caller boolean, replacement
owner or callback. An ambiguous close retains the actual private custody and
prevents that witness; repeated Close does not retry the selected descriptor.
The consumer must retain its original response/Source loan until this port's
actual close witness and its own release acknowledgements permit release.
Transport cleanup must run outside Source/response locks.

## Shop consumer integration

The original Shop Auth client must replace its per-read ordinary `Call` with
this owned call on the same configured client, store the returned exact
exchange in its original response, and preserve nonnil late partials. It must
not probe a different connection before its real GET. The existing fixed
`GET /v5/shop/source/shop.order/invoice-intents/{orderID}`, empty body/MIME,
no-query rule, selected order, actor/role/Store map and 1 MiB aggregate response
bound remain the consumer's normal contract.

The original client-side Root record currently supplies server UID/PID but
does not supply the required server start/image expectations. That is original
Auth/Root owning code and registration work. Empty original client rows remain
closed until those independent bindings and the original Source permission
exist. The service resource's peer is its allowed caller and cannot be reused
as this client's server identity. No TaskGrant purpose grants Shop access.

The old P09 held transport's four-ACK protocol and its original Source brand
are not used by this exchange. No new remote endpoint, handshake or second Go
runtime/archive is introduced.
