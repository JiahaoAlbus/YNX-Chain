# Wallet/IDE V4 management DATA wire — draft, not deployed

This is the sole SDK proposed management wire, acknowledged by parent for Auth matching. It does not modify the existing pair/challenge/complete HTTP handler. Auth must confirm and implement independent management Source/Native/current qualification. In particular UNKNOWN pair/completion may have no active session: an ordinary GET read lease or an invented future sessionBinding is not a recovery authority.

All four methods are POST, exact Content-Type application/json. Body original is strict UTF8 canonicalJSON (existing SDK canonical.js lexicographic keys), maximum 393216 bytes. Duplicate/unknown keys, alternate serialization, invalid UTF8, proxies, getters, sparse arrays, SharedArrayBuffer and detached input are refused. Output bytes are owned copies, not immutable security capabilities.

|operation|path|exact body keys|
|--|--|--|
|active|/v4/product-sessions/active|request,registrationOriginal,account,sessionBinding|
|recover|/v4/product-sessions/recover|request,registrationOriginal,account,operationId|
|revoke|/v4/product-sessions/revoke|operationId,request,registrationOriginal,account,sessionBinding|
|cancel|/v4/product-session-challenges/cancel|operationId,request,registrationOriginal,account,challengeId|

Original issuer field meanings are preserved. registrationOriginal is the original canonical registration string, not reassembled registration fields. account is the existing YNX address; operationId is original opaque operation identity, not a generated recovery ID. active sessionBinding is a lowercase SHA256 hex string; revoke permits null for the existing registration-wide revocation branch. cancel challengeId retains the existing base64url challenge. No caller-specified URL/method/route/provider is accepted.

Proof header remains x-ynx-product-session-proof-v4. Existing 21 unsigned fields, E5 domain/u32(4)/network32/canonicalOwner/canonicalUnsigned, N1/index0/empty paths and full ML-DSA87 AND SLH256f proof are unchanged. bodyDigest is SHA256 of exact actual request body bytes. All existing V4 header/message/member caps remain unchanged. `inspectProductSessionManagementV4ProofDATA` cross-binds actual path/method/body, registration, original account/app/device tuple, registration digest/revision and independently supplied expected unsigned + device pair, then calls existing V4 proof math. Its `signatureVerified:true` means local math only; current/authorized/RootAdmission/SourceAdmission/NativeAdmission remain false. Native/Auth must independently assert current/registration/replay/scope and original source pre/post. Request syntax is checked at its own original issuedAt, never treated as fresh current observation.

Recovery is query-only. A separate independent recoveryTarget is REQUIRED by encode/decode/proof APIs for recover, exact `{kind:'completion',operationId,approvalOriginal,challengeOriginal}`. Existing `deriveProductSessionV4TargetData` derives the INTENDED binding from this request plus canonical original approval/challenge; op/account must match; the V4 header sessionBinding must equal that derived intended binding. This is NOT an active session. It cannot grant active/GET/revoke or read-lease authority. The independent originals come from actual protected original storage, not from member/header self-assertion; Auth must validate that provenance/current/approval independently. Missing target or kind pair throws `PAIR_V4_RECOVERY_SESSION_BINDING_NOT_DERIVABLE`: PAIR UNKNOWN cannot know server RNG/time/challenge, so cannot use this V4 recovery proof. Never fill 0, operation hash, or another session. A future pending-recovery protocol requires its actual Core/Protocol owner; this module does not invent it. active/revoke require independent actual session/current Source, not this intended binding.

Recovery is query-only. Request body cannot grow an extra originalBodyDigest key because the existing issuer contract is exact. Main retains the original operation and actual body bytes separately. `assertProductSessionManagementV4RecoveryDATA` checks SAME operationId and SHA256(actual original body) against the independent originalBodyDigest. This association grants no HTTP authority. The response independently carries the original store input SHA, if it exists. Never retry a business effect or mint another operation/nonce because of UNKNOWN or REJECTED.

Response is new exact EIGHT-key canonicalJSON, maximum 393216 bytes:
`{version:'4',operation,operationId,requestBodyDigest,originalRequestBodyDigest,state,original,code}`.
`requestBodyDigest` is this management query's exact body SHA, not the original business body digest. `originalRequestBodyDigest` is recover's original store input SHA256 or null for not-found/unresolved; it MUST equal the independently retained digest when supplied; all non-recover operations require null. active operationId is null; other operations require their SAME body operationId. state is OBSERVED/UNKNOWN/REJECTED only. OBSERVED requires nonempty original and code=null; recover also requires the matched original digest. Only Auth may map an actually COMMITTED original store record to OBSERVED; the codec cannot establish that source fact. ENTERED or not found recover results remain UNKNOWN. UNKNOWN/REJECTED require original=null, and code is null or a bounded uppercase error identifier. They do not prove absence of an effect. No DB row/raw input/member is projected into HTTP. Original result string is opaque; this codec does not parse it to manufacture grants.

All response decoding returns dataOnly:true, signatureVerified:false, executionVerified:false, queryOnly:true, retryAuthorized:false and false Root/Source/Native/current/authorized. There is no signed-response authority claim. HTTP status, durable bits or OBSERVED do not establish business completion/finality.

Proposed Node-only export (parent owns package changes):
`./product-session-management-v4` => node import ./src/product-session-management-v4.js; types ./src/product-session-management-v4.d.ts; browser/default null. No new signature domain, signer, store, Source factory, active switch or network operation.

Necessary new CI commands, package-root relative, with normal production dependencies:
`node --test test/product-session-management-v4.test.mjs`
`node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext test/product-session-management-v4.types.mts`
No old suite, GUI, native build or real account was run. Public temporary math key material is destroyed in finally.
