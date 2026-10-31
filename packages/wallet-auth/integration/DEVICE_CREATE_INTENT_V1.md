# Original device creation intent and actual Main approval boundary

Public Node-only DATA subpath: `@ynx-chain/wallet-auth/original-device-create-intent`.

- `createOriginalDeviceCreateIntentDATA(inputExact17)` constructs immutable DATA.
- `inspectOriginalDeviceCreateIntentDATA(originalBytes: Uint8Array)` reads the original canonical UTF8 terms. A JSON DTO, normalized re-encoding, duplicate fields or BOM is refused.
- `assertOriginalDeviceCreateSelectionDATA(view, independentExact6)` compares networkId/canonicalOwner/account/productId/clientId/deviceId. This never proves where the independent input came from or that it remains current.
- `assertOriginalDeviceCreateIntentUnchangedDATA(originalView,currentView)` refuses any change to original identity or full terms, including generation, operation, nonce and expiry.

The input has exactly networkId, canonicalOwner, account, productId, clientId,
platform, applicationId, bundleId, packageId, origin, callback, deviceId,
generation, operationId, nonce, issuedAt, expiresAt. Terms add version `1` and
domain `YNX-PRODUCT-DEVICE-CREATE/v1`, producing exactly19 fields. canonicalJSON
uses the original SDK sorted-key canonical JSON; bytes are exact UTF8 without
BOM. No device public key, registration digest, private key, signature, grant,
`approved` or renderer override belongs here.

Account must equal original `ynxAddressFromEVM(canonicalOwner)`. The eight
product/client/platform/application/callback fields match the original current
productPlatformBinding Registry exactly. This Registry match is DATA, not
Root/Source commissioning. Nonce is lowercase hex32 bytes; generation is a
positive canonical decimal U64. Original operationId is preserved as bounded
8..128 ASCII identity, never generated or replaced by this module. Times are
exact UTC millisecond ISO strings, 0 < expiresAt-issuedAt <= 30000ms. No current
clock is read by DATA decoding; original data can be expired and is still not
approval. Actual Main and Native authority must enforce their live deadlines.

`view.approvedTerms` is that original canonical terms string. `view.binding`
is `{bytes,sha3_512,sha512}` over exactly its UTF8 bytes. The historical native
field name `approvedTerms` does not mean that a user approved anything.

`view.stableDeviceIdentity` is canonicalJSON with exactly version `1`, domain
`YNX-PRODUCT-DEVICE-IDENTITY/v1`, networkId, canonicalOwner, account, productId,
clientId, deviceId. `view.stableIdentityBinding` binds those exact UTF8 bytes.
Generation, nonce, operationId, window, origin and callback are excluded from
the once identity. They remain immutable in full terms. UNKNOWN under the same
identity cannot escape through a fresh generation, request, nonce or path.
Rotation is a future independent epoch-transition contract, not create again.

`view.nativeIntentDATA` maps exactly network, stableDeviceIdentity,
approvedTerms, issuedAtMs, expiresAtMs; clock values are canonical decimal
strings for the NEW Auth Native contract. This is DATA only; it is not a
constructor/provider/capability for the historical native contract. Auth must
independently select a live Source and cap the Native wall/steady window to
the earliest original Source/profile/actual Main approval expiry; later reads
cannot extend it. The historical stableDeviceGeneration native slot must not
be used to create a second key under UNKNOWN.

Normal Main caller is `wallet:prepare-device-create`: no renderer-supplied
terms/account. Main reads the original protected provisioning held intent and
its real Vault-selected public account lease, decodes and independently binds
them, retains original bytes and both Bind values in its private review map,
then displays the review. Only the actual provider approve UI event passes
`captureOriginalWalletDeviceCreateApprovalIPC(event,reviewId)` and the original
once claim peer. That peer must bind the SAME private review original, not
only a reviewId/time window, and remain fenced by real unlock/session/account,
WebContents/frame/navigation and original Source/selection lifetime.

Only Auth's fixed `product-session-device-provisioning-source-v4` factory may
consume that original Main peer, verify the exact original terms/currentness,
and call protected prepare/keygen. Source profile issuance or JSON matching
alone is not user consent. Non-null Native/Source partials must be adopted
before status or late failure; close children before borrowed parents. No
re-keygen/retry, journal clearing or account recreation is a recovery path.

Creation consent only permits this local device-key creation. Subsequent
public pair registration/account authorization/challenge completion remains
its own original approval flow. Existing pending registration-pop or challenge
Source cannot bootstrap creation. Source, opaque NAPI factory, actual
approved Main/Native controller and same-source new Core library remain their
original owners' required integration gates. This module supplies none of
them; every view and comparison returns userApproved/SourceAdmission/
NativeAdmission=false. No signer, fetch, Keychain, fs, journal or Root is used.
