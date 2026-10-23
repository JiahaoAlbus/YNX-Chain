# Original developer contract connection

SDK `1.3.0-pq.3.32-auth.6` extends the original
`@ynx-chain/wallet-auth/walletconnect-dapp-connection` export.
`createDeveloperContractConnection()` fixes the origin to
`https://developer.ynxweb4.com`, chain to `eip155:6423`, and the remote methods to
`ynx_preparePQContractAction`, `ynx_preparePQContractBroadcast`, and
`ynx_getPQContractOriginal`. It retains the original SignClient lifecycle and
database. Construction performs no Relay initialization. Existing identity and
address profiles retain their separate permissions; restore rejects widened
namespaces and never deletes other profiles' stored sessions.

After explicit connect or restore, call
`connection.beginContractRequest({method, params:[body]})`. It returns an
immutable handle with `outcome`, `snapshot()` and `onCorrelation(listener)`.
Register the journal observer immediately, before waiting for the outcome.
An already observed correlation is delivered immediately on subscription;
otherwise the original sent event delivers it, including after a local timeout.
The returned function unsubscribes. Consumer callback failures cannot trigger a
retry or replace the original RPC cause. Notifications do not certify journal
persistence: await the owning journal's actual durable-write confirmation.
Persist the snapshot's
`originalRequestKeyHash` in the consumer's existing journal once observed.
The source is locked SignClient 2.23.10's `session_request_sent` event: the exact
same request object, original topic, chain, and generated safe positive RPC ID.
The hash is SHA256 of UTF-8 `JSON.stringify([topic,id])`, exactly Main's inbox
key. The SDK accepts no caller supplied topic or ID and exposes neither.
Equal concurrent requests remain distinct by object identity.

Missing or conflicting original correlation prevents a successful local
outcome. Timeout, rejection, or context change retains UNKNOWN. Late original
correlation can still be observed, but late success cannot turn UNKNOWN into
success. Snapshot state is local observation, not a signature, server receipt,
chain confirmation, cleanup proof, or authority. A consumer must independently
verify the returned business data. Do not resend prepare/broadcast after an
uncertain outcome; use the approved read-only original-query method if a
correlation exists. Missing correlation stays unresolved, including after a
restart without a journaled hash.

The client copies bounded JSON DATA before dispatch, checks the exact outer
method/body fields and selected account, and caps the serialized request at
61,440 bytes. Main independently validates the complete nested contract schema,
current session and account, purpose-specific permission, separate approval,
original compiler materials, and its actual 65,536-byte envelope. Passing the
client cap does not certify the final envelope. The cap cannot be overridden.
The old 75,135-byte ERC20 parameters remain a negative case; replacement
build-info bytes require their own original Go certification.

Controlled test seams do not initialize a real Relay, install a helper, grant a
Root, enroll a device, sign, submit, deploy, or prove actual login/recovery/
revocation. Native inputs remain the exact R154/R155 62 Node plus five helper
inputs. R154 `.5`, original R155 records, and the 6e App remain frozen. A new
runtime/package must pass the original Main/A adoption and actual release gates.
