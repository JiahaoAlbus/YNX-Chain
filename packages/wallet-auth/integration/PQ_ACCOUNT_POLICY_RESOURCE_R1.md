# Original policy resources: two distinct interfaces, R1

SDK contract owner: original Wallet/Auth SDK. Producer: original Auth normal
node adapter. API and exact genesis/version semantics: original Chain owner.
This interface freeze grants no source, Native, device, account or chain authority.

Both factories are protected-main/server-only fixed imports. No renderer-selected
factory, URL, origin, resource, resolver or public-key registration is accepted.
Source accepts only the original canonical network and node configuration.
Absent deployed semantics or original-source recognition: reject, never return
a test kernel, parsed DTO, backup public key or substitute resource.

## Common owner lifecycle

`assertCurrent(): undefined` checks the original local expiry, generation,
retirement and retained failure fences synchronously, without network IO.
`readOriginal()` returns the same immutable first observation, never a renewed
deadline, substituted owner/network/pair, truncated record set or advanced anchor.
`recheck(): Promise<undefined>` checks the same original node, binding and original
deadline before and after IO. It must not replace or renew the first observation.
Every method throws on refusal; truthy return values are not grants.

`retire(): undefined` synchronously fences use, once. `join(): Promise<undefined>`
retains the same draining operation. `close(): Promise<undefined>` retains the
same first closing promise and outcome, after successful join only. Original
owner retains partial acquisitions and UNKNOWN debt; a join failure must not
cause a second close/acquire, hide the first cause or authorize a write retry.
SDK capture borrows the resource; it does not take ownership of cleanup.

## Session committed policy

Factory: `acquireOriginalAccountPolicy({networkId, owner, operation, at})`.
`networkId` is the original genesis 64 lowercase hex; `owner` is preserved
canonical 0x address. `operation` is approval/challenge/completion/introspection/
revalidation. `at` is canonical ISO time, not an authority claim.

`readOriginal(): ProductSessionCommittedPolicyView` exactly matches
`src/product-session-account-policy.d.ts`. It contains committed checkpoint
height/hash, policy version, algorithm, full active pair/revision and the
fixed observedAt/expiresAt. U64 values remain decimal strings. It has no ledger
nonce or next-execution admission projection. The checkpoint category names
the real node producer; it does not assert BFT finality or a self-proving hash.

Recheck must prove the original anchor remains canonical and the exact committed
active account policy remains current. A more recent tip alone cannot prove
historical continuity. If that query is unavailable, refuse rather than
silently advancing the original anchor. SDK captures through
`captureProductSessionAccountPolicy(resource,{networkId,account:originalYNXAddress},at)`.
Then `readProductSessionAccountPolicy(observation,account,at)` checks the same
original resource. Session proof and scopes use the existing session engine.

## Transaction execution policy

Distinct factory:
`acquireOriginalWalletTransactionPolicy({networkId, nativeChainId, owner, operation, at})`.
`nativeChainId` is decimal string `6423`; `operation` is transfer or migration.
This is a versioned supplier interface; the normal factory is NOT SUPPLIED yet.

`readOriginal()` returns exactly:
```
{
  version: 'YNX-WALLET-TRANSACTION-POLICY/v1',
  networkId: originalGenesis64Hex,
  nativeChainId: '6423',
  canonicalOwner: preserved0xOwner,
  authorization: originalCompletePQAuthorizationDTO,
  observedAt: canonicalISO,
  expiresAt: originalCanonicalISODeadline
}
```
`authorization` is precisely the existing R2 `PQAuthorizationDTO` from
`src/pq-wallet-policy.d.ts`: ledgerNonce, next executionHeight, config enabled/
enableAt/networkId/policyVersion when installed, complete ordered records and
activeRevision when active. Decimal strings/full keys are unchanged. It is NOT
a session committed view, transaction receipt, finality proof or grant to send.

Consumer uses the ONE existing parser:
`parsePQAccountAuthorization(original.authorization,{chainId:original.networkId,nativeChainId:original.nativeChainId,owner:original.canonicalOwner})`.
No second policy parser or login engine. Source must authenticate the actual
node response, preserve complete records and reject unhealthy/uncertain state.
Recheck obtains another real complete execution projection and uses existing
`assertPQAuthorizationCurrent(originalSnapshot,freshSnapshot)` semantics:
height may advance monotonically; nonce/config/records/active policy must remain
identical. Activation, rollback, reorg, nonce change, incompleteness or expiry
invalidates the original review and refuses signing. No silent review refresh.

Normal App sequence remains original pending WeakMap/permission/keyAccess lease:
acquire and immediately retain original -> read/current -> exact existing R2
plan -> display/approve original review -> await same resource recheck ->
current+original permission fence -> original Vault withPQKeys + typed SDK
sign -> current+original permission fence -> original intent journal/save/
submission state machine. Retire/join/close by the original retained owner on
all paths. A late refusal retains signed material under the original journal
and UNKNOWN rules; it does not permit automatic re-signing or replay.

## Current admission

IDE parent remains SDK20/r6a; it is independent of both resources above.
Auth r12 implements session owner lifecycle but normal factory explicitly
refuses `AUTH_ACCOUNT_POLICY_COMMITTED_SOURCE_NOT_SUPPLIED`. Transaction normal
factory is not yet delivered. Neither resource may substitute for IDE Source
enrollment/profile/current/release registration or Native device qualification.
