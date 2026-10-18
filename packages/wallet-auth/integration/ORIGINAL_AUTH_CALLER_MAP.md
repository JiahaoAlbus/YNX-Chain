# Original Auth caller contract and version boundary

This document maps implemented calls and type-only contracts in `1.3.0-pq.3.22-auth.1`. It does not
register a credential or approve a Source release. Auth's R82 request schema is
consumed unchanged; its three Native implementations remain incomplete.

## Existing common Node entry

`@ynx-chain/wallet-auth/original-ide-admission` exports the original implementation
directly. It is Node-only; browser and default runtime resolution are refused.
There is no provider, key, root, grant, path or clock injection parameter.

| Export | Caller / input | Output / authority | Failure and lifecycle |
| --- | --- | --- | --- |
| `acquireOriginalIDEAdmissionParentDelivery` | Original backend, actual `Resources/server.mjs` file URL, also bound to `process.argv[1]` | Same fixed Native parent's owner, or `null` for unconfigured selection; descriptor `-1` is partial cleanup custody, not admission | No alternate module or reacquire; original owner `assertCurrent` / `close`; caller retains partial before checking readiness |
| `acquireOriginalIDEPrivateServiceChannel` | Same backend URL after the same parent acquisition | Same Native private client; existing canonical four-operation dispatch and original response | Original first cause / UNKNOWN retained; no resend; retire transport, then drain/join/close the original owner |
| `getOriginalIDEPrivateServiceChannelCleanup` | Same backend URL | Selected partial cleanup custody, or `null` if never selected | Cleanup only, including falsy acquisition failure; no new selection |
| `acquireOriginalIDEColdTerminalCustody` | Same fixed running backend URL | Retained original terminal DATA with `dataOnly:true`, `effectRetryAuthorized:false`, `nativeAdmission:false` | Independent fixed Native Source qualification remains necessary; no dispatch, ACK, effect retry or account recovery |
| `getOriginalIDEColdTerminalCustodyCleanup` | Same backend URL | Same selected cold partial cleanup custody | Does not retry acquisition or clear UNKNOWN |

The existing service scope is `wallet-product-session-v2`, product `developer`,
platform `macos`, gateway `https://wallet-auth.ynxweb4.com`. Its operations are
`beginYNX`, `handleReturn`, `restore`, `disconnect`. Here `restore` means product
session restoration, not identity/key recovery. Private frames bind the original
request nonce, installed receipt digest and consumer manifest digest, then the
exact operation, phase, request ID and canonical request digest. Current checks
remain in the original Native/JS lifecycle; an import or parsed DTO grants none.

## Pending canonical Native interfaces

| Interface | Original owner and current state | Required consumption boundary |
| --- | --- | --- |
| Identity reception | Auth: R65 `copyOriginalProvisioningPublicOriginals:` returns signed public DATA. R66 filesystem installation exists as a draft, without normal receiver hookup | Normal owned Source -> fixed kernel-UID registry install -> original cold readback. R65 alone cannot authorize an IDE parent |
| Identity/key recovery | Auth: R82 canonical request schema supplied; Native `recoverOriginalIDEIdentity` implementation remains incomplete | Separate recovery purpose, original account/history, current keyVersion and trusted rotation/revocation policy. Existing terminal DATA or product-session `restore` cannot substitute |
| Protected-key invocation | Auth: authenticated reserve -> original protected current-key borrow -> R49 hookup remains incomplete | Exact original purpose/request binding and protected same-owner custody. Ordinary login never grants recovery, export or transaction signing |

No JavaScript placeholder export is supplied for these incomplete Native calls.
The original Auth owner defines canonical dual-PQ credentials/trust and the
Native wire contract. IDE and Wallet consume the shared contract without
separate identity systems. Existing
`pq-wallet-contract` validates chain-account public-pair DATA, not Auth trust.
The legacy Auth Source verifier retains its Ed25519 v1 contract. The new R84
dual-PQ verifier is separate and does not silently replace an installed Native
entry or upgrade its Source provenance.

## Shared canonical request and verification DATA

`@ynx-chain/wallet-auth/auth-identity-contract` is a Node-only direct export of
Auth's unchanged `native/original-auth-identity-v2-contract.mjs` (R82,
SHA256 `b8c4a15f42ffc31bdf3913065df648abc537dcf0d1c5844e4a953ba6ac93d494`).
The sibling `.d.mts` supplies `OriginalAuthIdentityRequest` and
`OriginalAuthIdentityPurpose`. Exact request fields and functions are defined
there once. The machine contract is
`integration/AUTH_IDE_NATIVE_CALLEES_R82.json`; its `implemented:false` flags
are retained. This is a canonical request definition, not a complete credential.

`@ynx-chain/wallet-auth/pq-registered-member` exports
`verifyPQRegisteredMemberData(snapshot, memberWire, expected)` and
`assertPQRegisteredRecoveryBindingData(snapshot, publicBinding, expected)`.
The context is `{chainId, owner, keyVersion, executionHeight}`; verification
also requires Auth-owned `{purpose, message}`. Heights and keyVersion are full
canonical U64 decimal strings. Actual height, full active pair and revocation
are checked against the existing branded complete policy snapshot. Parsed
snapshot origin/finality is not authenticated by these helpers. The unique
existing batch provider explicitly uses `portable`, with no fallback or shared
cache. Its safe-Number coordinate is local math only; actual U64 lifecycle
checks are performed outside it without rounding.

`@ynx-chain/wallet-auth/auth-identity-verification` exports:

- `verifyOriginalAuthIdentityMemberData(snapshot, wire, requestRaw,
  expectedRequestRaw, purpose, atMs)`: original R82 exact request/purpose/window,
  original encoded bytes, shared full-pair dual-AND math, and Auth's mandatory
  N1/index0/empty-path constraint.
- `verifyOriginalAuthIdentityRecoveryData(snapshot, wire, publicBinding,
  originalRequestRaw, recoveryRequestRaw, expectedRecoveryRequestRaw, atMs)`:
  same verification for recovery plus original principal/account continuity and
  full current registered pair equality. It cannot restore or export keys.

Both return immutable DATA with `authorized:false`; nested verification has
`nativeAdmission:false`. They return no receiver, signer, role, key or replay
permission. Bad/missing inputs throw with the original error code. There are no
effects, retry loops or UNKNOWN-clearing actions. Original Auth must acquire and
recheck genuine Source/current/credentials/permissions around these helpers;
products must not replace that with a caller-created parsed DTO. Ordinary login
cannot be passed as receive/recover/key-call purpose. Real Native partial owner
and UNKNOWN cleanup remains the existing original lifecycle, not these DATA
results.

## Auth R86 Source verification DATA

`@ynx-chain/wallet-auth/auth-source-verification` directly exports Auth's original
`native/original-auth-identity-source-v2-verifier.mjs` unchanged from R86 (SHA256
`9c6b11fc7c0af2e1a9fa047d04d2cd907087eba2af71ca09274dda980587fbe4`).
The sibling `.d.mts` supplies `OriginalAuthSourceV2Policy`,
`OriginalAuthSourceV2Registrations`, profile/current DATA and gate types.
This Node-only entry uses the same shared registered verifier and policy brands;
it creates no second crypto engine or product-specific identity system.

- `verifyOriginalAuthSourceProfileV2` binds the independently pinned Root,
  enrollment/profile originals and three distinct registered role owners with
  distinct full key components, exact network/revision/height and Auth purposes.
- `verifyOriginalAuthSourceCurrentV2` additionally binds original nonce,
  profile digest, sequence/floor/head, status, fixed window and subject revision;
  it preserves the original opaque principal and signed permission metadata.
- `selectOriginalAuthSourceAlgorithm` supplies the explicit legacy/v2 policy
  decision. Migrated active accounts reject v1; revoked accounts reject both.
  The installed Native entry must actually enforce it on every relevant path.

Enrollment/profile `envelope.executionHeight` is immutable signed issuance H.
It may precede current observed H if the signer was active at issuance and its
current full registered pair/revision remains valid. All four authenticated
role/subject snapshots must share the actual current observation H. A current
statement must be newly signed at that observation H; old current cannot be
relabeled. Profile DATA exposes `credentialIssuedHeights` separately from its
current observed `executionHeight`.

Breaking candidate-only change: current verification's `previous` now requires
canonical U64 string `executionHeight` as well as sequence/floor/head/timeFloor.
Native initializes it to `'0'` and retains the last genuine observation H; lower
observations and old four-field inputs are refused without a silent default.
Do not mix SDK320/321 callers or installed Native components with this changed
input. The two-phase ABI types and R82 wire/purpose are unchanged.

All results remain immutable `dataOnly:true / nativeAdmission:false`. Native
must acquire authenticated role/subject snapshots and independently check
protected registry/current before and after use. The public verifier cannot
supply those resources or infer authority from RPC, a Member's own public keys,
a receipt or a caller-created snapshot. Role enrollment is not a user recovery
or generic transaction-signing permission. Source CLI dispatch, large-PQ Native
capacity and the three real callee implementations remain with original Auth.

## Product and package ownership

`@ynx-chain/wallet-auth/auth-native-contract` is a **type-only** subpath.
`OriginalAuthIDENativeBinding` describes the original fixed Native module; the
SDK exports no runtime function or loader at this path. JavaScript imports are
refused in Node and browser. Types are not proof that Native callbacks exist.

The two-phase contract in `integration/AUTH_IDE_NATIVE_TWO_PHASE_ABI.json`
supersedes R82's provisional constructor-request semantics. Receive/recover
constructors accept only the actual entry URL; the protected-call constructor
also captures the canonical intended invocation DATA. The SAME opaque Native
owner/partial is returned before late readiness checks. Retain it before
calling `assertReady()`; do not auto-dispose, reacquire or wrap it as successful.

`copyRequestOriginal()` returns canonical R82 JSON generated by Native. A
genuinely permitted provider signs the exact
`encodeOriginalAuthIdentityRequest(parseOriginalAuthIdentityRequest(raw))`
message with the Native-held purpose. `completeProof(memberWire)` accepts no
caller-selected expected statement, clock, account, Root or permission flag.
It selects once; UNKNOWN/rejected effects are never replayed. Only the original
protected-call owner has `invoke()`, with no operation/key/path/callback input.

Lifecycle calls are synchronous. `status()` exposes only immutable phase,
ready/unknown/retired/cleanup/disposed flags and normalized `firstCauseCode`
(`string|null`). `verified` means key-call proof verified, not effect completed.
UNKNOWN survives retirement/disposition. `disposed-error` and the original
close failure must not become success after another close. `result()` and
`invoke()` remain `unknown` until actual permitted public receipt variants are
defined; no success DTO or secret-return shape is invented here.

These types do not implement or activate the three Native constructors,
source qualification, recovery, or protected-key effects. Real callbacks and
normal entry ownership still belong to original Auth. Product callers must
check actual fixed binding availability and retain its original partials.

- SDK owns `packages/wallet-auth` JavaScript, types, exports and new focused tests.
- Auth owns canonical Native receiver, recovery, protected-key implementation,
  lawful credentials, trust, keyVersion and revocation/rotation/recovery semantics.
- IDE owns `desktop/wallet-admission-startup.mjs` and
  `desktop/wallet-admission-delivery.mjs`, UI and the actual running-entry caller.
- Original A owns matching Native/App packaging; existing GUI packages do not
  acquire newer Auth semantics merely by being rebuilt.

The reported IDE source `3560d63cbaa3b76df4ce63231e39fd1d2eba3387`
still consumes SDK317/R51. Frozen SDK318 is source
`74df27c9cce9adb78d26922a3c8dd42b8ea642d0`; neither baseline contains the new
formal canonical Native parent. This successor's Node export does not upgrade
an installed IDE or activate new Auth. Exact Native/SDK/App identities, install,
normal successful identity reception, recovery, protected calls, rejection,
revocation, restart and UNKNOWN readback remain separate acceptance gates.

Existing account/permission/history and uncertain effects stay intact. Legacy
migration/login entry points must not become fallback around the new policy.
