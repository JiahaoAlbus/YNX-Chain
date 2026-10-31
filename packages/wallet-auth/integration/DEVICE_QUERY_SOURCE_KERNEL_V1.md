# Independent cold device original-outcome query Source

Implemented/tested Source CODE, not actual Root admission or a device query
result. No Native/Main/parent provisioning/Social issuer files are changed.

## Purpose and private closed DATA schema

Dedicated purpose/service: `product-session-device-query-source-v4`.
Only operation: `['device.original-query']`. No creation-prepare, registration
PoP, challenge completion, signing, keygen, recovery or new/replacement slot.

Original v2 enrollment/profile/current envelope schemas and signature statement
domains are unchanged. The new exact profile selection is:

```js
{
  association: {account,clientId,productId,platform,applicationId,deviceId},
  expectedRequest: {service,productId,platform,applicationId,gatewayOrigin,
                    registryDigest,operations:['device.original-query'],instanceId},
  originalHostStatePath,
  originalHostTerminalDirectory: originalHostStatePath+'.private-terminal',
  productSessionDeviceV4Query: {
    version:'4', stableDeviceIdentity,
    identityBinding: {networkId,canonicalOwner,account,productId,clientId,
      platform,applicationId,bundleId,packageId,origin,callback,deviceId}
  }
}
```

All objects above have closed exact fields at runtime. No `intentOriginal`,
approved terms, creation expiry, device generation, operation ID, nonce,
registration ID, device public/private key, pending challenge, or creation/
pending journal is accepted in the query scope. Outer original Source profile
`generation` remains its existing Source lifecycle counter, NOT device slot
generation; it never enters the stable device identity.

`inspectOriginalProductDeviceV4QueryScopeDATA(scope, association, root.networkId,
profile.subjectOwner, profile.issuedAtMs, profile.expiresAtMs, now)` is declared
in the matching `.d.mts`. It returns DATA with `queryOnly:true`, `authorized:false`,
`nativeAdmission:false`, `deviceKeyAccess:false`, `registrationPerformed:false`.
The latter means this operation registered nothing; it does NOT assert that a
previously registered original device is unregistered. It supplies no outcome,
device-state authority or user consent.

## Sole SDK canonical stable identity, no second codec

Exact SDK local supplier:
`sdk49-stable-device-identity-v5-20261031/source/packages/wallet-auth`,
SOURCE_COMMIT `51ebf8310d30f08de569fc5db5a40bb61277ef67`, tree
`a42d219ab2fd4fed3fae70af47511f6f82d51ecf`. This was a supplied non-Git source
overlay, so commit/tree provenance comes from its `SOURCE_COMMIT.json`, not an
invented local checkout/remote verification. Remote/public release not claimed.

Test creation uses the exact public SDK
`createOriginalDeviceIdentityDATA(exact12)`. Production Source scope verification
calls ONLY `inspectOriginalDeviceIdentityDATA(canonicalIdentityUTF8, exact8
independentApplicationBinding)` from the original `original-device-create-intent.js`.
SDK retains the original version/domain+stable6 canonical eight-field identity.
Source compares returned stable6 with all selected fixed identity fields,
root.networkId, subjectOwner and association; SDK checks account-owner and the
full fixed product/client/platform/application/bundle/package/origin/callback
registry relation. Source does not parse/re-encode an alternative identity.
Missing SDK export is explicit UNAVAILABLE, never fallback through old creation.

## Independent lifetime and original full AND gates

Query enrollment/profile windows remain independently Root-approved and current,
bounded by the original v2 limits (≤24h, profile contained in enrollment).
Fresh nonce Source current remains ≤30s and contained in profile/enrollment.
Neither is capped by expired creation terms, and neither revives those terms.
The test vector has original creation expiry 5000; independent query profile
90000..110000 and query time 100000. Canonical stable identity is byte-identical.
The query scope itself cannot be passed to original creation inspector/prepare.

Original verifier still requires pinned Root/enrollment, full dual-PQ signatures,
registered full pairs, distinct root/profile/current roles, subject account,
same observation heights, active epochs/revocations, exact registry/request,
profile identity/window, head, sequence/floor, nonce and fresh active current.
Dedicated query head is SHA256(canonical exact query scope). Added dispatch is
limited to new purpose, field, operation and query contract in the inherited
original v2 verifier/issuer/current. No old Source family predicates are relaxed.
The protected original issuer still requires its independent exact approval,
original role keys/Native runtime/custody, pre/post checks and retained partials;
current still retains Source journal history, UNKNOWN, terminal revoke and close.

## Normal acquisition and Main boundary

`src/original-product-device-v4-query-source.js` exports zero-argument
`acquireOriginalProductDeviceV4QuerySource()` and
`acquireOriginalProductDeviceV4QuerySourceIssuer()`; both normal release-selected
tables are EMPTY. Caller arguments/approved JSON/selection are denied. No setter,
HTTP signing endpoint, default source-approved or automatic material is supplied.
The future fixed release rows call the actual original protected loaders, not
test kernels. Empty tables fail NOT_ADMITTED before any protected-key effect.

This is Source query scope CODE, not the original Main private query-selection
peer. Main owner must independently bind its exact admitted private peer,
identity, readonly original outcome transport and normal request method/path;
read pending/registered originals without prepare, slot restoration, enrollment,
registration, private-key access or replacement. This module cannot turn Source
DATA or an arbitrary path/header into that peer. Malformed/traversal host paths
and mismatched terminal paths are rejected by original validators; arbitrary
alternative absolute request paths are NOT authorized by this DATA. Main's
actual request path/peer remains its separate gate.

Source profile/current cryptographic administration and Source journal writes
are distinct from device operations: query authorizes no device signing or
device/slot writes. Tests use only mathematical Source-role keys and in-memory
Source journals. No real Root, account, private key, service or device was touched.

## Verification and integration

`node run-query-source.mjs /absolute/soleSDK/source/packages/wallet-auth --real-math`
stages immutable SDK+r4 suppliers and this overlay, then runs only the new group.
Complete stdout/stderr/exit/source pins are saved in unique `evidence/query-*`.
No old green groups rerun. Two explicit layers:

- Lifecycle matrix executes actual original verifier+issuer+current with declared
  PUBLIC-only registration/math/signer/IO seams; no genuine custody claim.
- Separate NO-MOCKS test uses real SDK-branded complete policy snapshots, real
  dual-PQ signature verification and actual original issuer/current kernels.
  Ephemeral portable mathematical role keys stay in memory and are destroyed.
  Both signature corruptions, Root pin, four role revocations, wrong epoch/role,
  nonce and expiry deny. Mathematical Root/approval fixtures are NOT authority.

`node run-query-types.mjs /absolute/isolated/package /absolute/local/tsc.js`
checks public DATA API and negative scope/identity/operation/authority cases,
downloads nothing and retains complete separate type raw. Add these commands to
the owning integration CI when applying this non-Git overlay; no shared CI or
parent frozen source was edited here.

Policies fully read/applied: original `YNX_EXECUTION_POLICY.md` and product-core-
first policy. Writes only this directory, no subagents, no actual Root approval,
real signing, private key read, SSH/deployment, new slot or Main/Native changes.
