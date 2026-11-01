# Network Resource Source v1: finite DATA and registered math

Only `public_block_histogram` / `resource.public-block-histogram` is supported.
Source purpose `network-resource-source-v1`; selection key `networkResourceV1`.
The existing sole canonical JSON encoder and E5/batch codec are reused. No worker,
Root row, operational key, Native factory, consent UI or new crypto implementation
is supplied. All successful DATA/math outputs remain admission false,
productionDisabled true and rewards NOT_AUTHORIZED.

## Exact producer objects and bytes

Work has exactly six P09 fields: job, kind, issuer, input, limits, expiresAt.
Consent has exactly seven: principal, job, manifest, limits, expiresAt, nonce, allow.
Input/manifest Binding is exact bytes(decimal u64 string), sha3_512 and sha512
(lowercase 128hex). All five original limit names retain their own semantics.
The new canonical production Work and Consent are encoded with the existing sole
Source canonical encoder, not Go sandbox-domain wrappers. Original input bytes
are captured and hashed, never reconstructed JSON. Only UTF8 JSON object input,
1..4194304 bytes; cpuMilli 1..1000, durationMillis 1..5000, storage/egress zero,
memory >=129*65536+2*inputBytes+65536 and <=24MiB. UTC RFC3339Nano Z-only is the
explicit narrower production expiry grammar; exact string retained, valid calendar,
future <=24h, consent no later than manifest. This does not supply hard OS quotas.

Scope exact six fields: version=1, protectedResourceRef, issuer, manifestOriginal,
consentOriginal, request. See .d.mts for closed nested fields. issuer.keyEpoch and
request.principalKeyEpoch are independent positive full-u64 decimal strings.
Publisher and principal current selectors are protected Source references; callers
cannot bootstrap trust by filling them. Current observations separately bind issuer,
publisher, principal, originalCaller, request and lifecycle, and have explicit
revoked/cancelled/stale/unknown/unavailable refusal, max30s freshness. A valid
shape/current comparison remains DATA and supplies no provenance.

## Fixed signature messages and public math

Manifest domain: `YNX-NETWORK-RESOURCE-MANIFEST/v1` (no terminal NUL).
Manifest certificate purpose: `NETWORK-RESOURCE-MANIFEST`.
Consent domain: `YNX-NETWORK-RESOURCE-CONSENT/v1` (no terminal NUL).
Consent certificate purpose: `NETWORK-RESOURCE-CONSENT`.

Both use sole encodeFields/E5 in this exact order:
1. domain UTF8; 2. u32(1) BE; 3. raw network32;
4. canonicalSignerOwner UTF8 (0x + lower40hex); 5. keyEpoch UTF8;
6. issuedHeight UTF8; 7. canonical body UTF8.
Manifest body exact {version:1,purpose,protectedResourceRef,issuer,manifestOriginal}.
Consent body exact {version:1,purpose,scope}, binding entire original manifest,
input double hashes, independent principal epoch/caller/request/lifecycle, allow,
nonce, limits and expiry. Canonical JSON is DATA within the signed E5 frame,
not a signature by itself. Domains/purposes are separate from Source-v2 enrollment
approval domains and from SANDBOX v1, NodeLocalDecision, AI or TX authority.

`encodeOriginalNetworkResourceSignatureMessageV1DATA(...)` supplies exact bytes.
`inspectOriginalNetworkResourceSignedMemberV1DATA(...)` uses the sole registered
member verifier, requiring actual ML-DSA-87 + SLH-DSA-SHA2-256f AND, N=1/index=0,
empty both paths, exact full registered pair, owner/network/purpose/message/epoch.
Signature's issuedHeight may be older than independently observed snapshot height;
future issuance is refused, and current active/revoked registration is still checked.
The independently acquired branded snapshot is an input to PUBLIC math, not proof
that caller supplied a genuine Source. No key or owner is derived from member or
Work/Consent text. Auth must independently map issuer text and principal text to
separate protected canonicalSignerOwner/registered pair and current keyEpoch.

## Required private Native callee, not implemented factory

`native/original-network-resource-source-private.d.mts` defines required zeroarg
acquire/recognizer, prepareReview and produceConsent ports. It is a typed requested
ABI for Auth, not an existing C/NAPI symbol, implementation or Native admission.
Original protected RootSource resource lookup precedes registration borrow; ordinary
Runtime/current DATA cannot bootstrap its own Source. SAME Source/context captures
manifest/input, independent issuer and principal currents, original caller and actual
request lifecycle. Native must independently confirm the protected consent UI and
sign exact pending bytes. No JS callback/provider/setter/boolean can create owner.
Adopt partial owner before errorPresent, preserve falsy first errors. Child review,
consent and once-claim must retire/join physically before source close; pending join
cannot close parent. UNKNOWN preserves original manifest/job/request/nonce; no new
nonce, replacement operation, replay or automatic grant restoration after restart.
Atomic durable once claim is original Native owner's job; DATA FRESH never consumes.

## Exact P09 consumer integration and outstanding CODE

Consumer immutable Git 1add2c444b70e7b31248e421affe345b3d0d9aaa; reference pins
are in CONSUMER_SOURCE.json. Existing contribution.Authorizer has VerifyManifest
(ctx,issuer,payload,signature) and VerifyConsent(ctx,principal,payload,signature).
Existing ManifestPayload/ConsentPayload, checkWork manifest binding, result/history
bindings use SANDBOX_V1 wrappers. They must not be passed as these production bodies.
P09 owns a production adapter and consistent canonical original manifest binding
through checkWork/result/history; old sandbox bytes/functions remain unchanged.
Existing nativeconsent LocalDecision authenticates node UI/action, not this resource.
No production Native Resource producer/recognizer, protected issuer+principal mapping,
registered selection/current Source dispatcher branch, Native Source selector or durable
claim callee is implemented by this SDK patch. Auth owns these concrete missing ports;
SDK does supply exact schema, bytes and registered public math now. No default rows.
NewDisabled stays default and productionReady remains false even when math passes.
Hard RSS, CPU-share and total disk enforcement remain separate P09 owning requirements.
No rewards, payment, finality, execution, Source/Root/signing approval is granted.

## Parent integration

All files are ADD against Git0ae16b9. No common dispatcher/policy/issuance/current,
package.json, Main, Auth or Native source was edited. Parent can add Node-only export
`./network-resource-source-data` with types ./src/network-resource-source-v1.d.ts,
node ./src/network-resource-source-v1.js, browser/default null. Public exports are
DATA/math only; private ABI declaration is not a runtime getter. CI driver runs only
new contract/signature groups and strict new types. No old matrix/worker/GUI runs.
