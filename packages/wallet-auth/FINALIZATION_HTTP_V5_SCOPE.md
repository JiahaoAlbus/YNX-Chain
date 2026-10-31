# Finalization and HTTP V5 Source-v2 DATA/verifier integration

This independent successor preserves e9 Source verifier50060/SHA256 bc6b77a8f0f46459dee6b48f96f0dc47a58523cc3191a07f37eae14b810c252a. It adds only two dedicated pure DATA contracts and branches on the existing actual verifier. Parent separately owns Current/Issuance caller selection, sensitive/pre-key fences, expiry/types/zero-DTO factories/exports/package/CI. No Auth/Main/old source/shared output was edited.

## Exact normal interfaces

`native/original-product-device-v4-registered-finalization-source-contract.mjs` exports:

- PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_PURPOSE = product-session-device-registered-finalization-source-v4
- PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_OPERATIONS = [device.registered-finalize]
- inspectOriginalProductDeviceV4RegisteredFinalizationScopeDATA(scope,association,networkId,subjectOwner,profileIssued,profileExpires,at)

Signed scope key is productSessionDeviceV4RegisteredFinalization. Scope exact7 is version:'4',expected exact16,originalCreationTerms19,originalCreationOperation,originalRegistrationOperation (required string|null key),registrationOriginal,associationOriginal. Original creation19 is parsed by original inspectOriginalDeviceCreateIntentDATA; identity12/gen/op must exactly bind expected and original registered record generation. Its <=30s time window is historical DATA; no creation approval is revived and old creation expiry does not clamp a fresh registered finalization profile. Fresh profile/current windows must remain within actual registered record time. Registration codec/digest/current scope and Root role/device pair collision fences are reused.

AssociationOriginal is retained as bounded original string DATA, not reconstructed or called registered. Actual same native item/privateframe/persistentRef/protected journal/current and independent registered/completion/association verification remain the original Native/Source owner's responsibility. Journal is not cryptographic generation authority. Root/profile statement covers the complete exact terms19/gen/op/registration full pair/association selection; actual independent Root/current and registered verification are still required. Return fields include expiresAtMs, devicePublic, originalGeneration, originalCreationOperation, originalRegistrationOperation, historicalCreationTerms:true; registered/current/localAssociationFinalized/authorized/nativeAdmission remain false. No session or new grant is created.

`native/original-product-session-http-v5-source-contract.mjs` exports:

- PRODUCT_SESSION_HTTP_PROOF_V5_SOURCE_PURPOSE = product-session-device-http-binary-source-v5
- PRODUCT_SESSION_HTTP_PROOF_V5_SOURCE_OPERATIONS = [device.current,device.http-proof-v5]
- inspectOriginalProductSessionHTTPProofV5SourceScopeDATA(scope,association,networkId,subjectOwner,profileIssued,profileExpires,at)

Signed scope key is productSessionHTTPProofV5. Scope exact7 is version:'5',expected exact17,context exact12,registrationOriginal,sessionOriginal,targetURL,maxBodyBytes. The original V4 scope helper is called solely on a version4 DATA projection to parse the SAME registered facts, complete original session, pair/account/current bindings and scopes. It does not borrow a V4 Root purpose, GET Source/producer or permission. New V5 family/purpose/operations/current qualification remain independent.

TargetURL must be canonical HTTPS with <=2048 UTF8 bytes and hostname<=253, no credentials/query/fragment (including bare ?/#), and exact pathname /api/v1/ide/deployments. MaxBodyBytes is a required positive canonical decimal string <=68288512 with no override/default. No method, path, budget or domain is silently mapped.

HTTP return effective ceiling field is expiresAtMs = min(profileExpires,registeredRecordExpires,sessionExpires). It also returns normalScopeDATA with exact8: version,targetURL,networkId,pkA,pkB,identity,expiresAtMs,maxBodyBytes. Identity exact14 is sessionBinding,productId,clientId,applicationId,bundleId,packageId,origin,callback,account,canonicalOwner,deviceId,deviceRegistrationId,deviceRegistrationRevision,deviceRegistrationDigest, derived from the validated SAME session/expected/registered originals. Pair is the SAME record's full pair, not header/account keys. This pure helper does not possess actual current-lease expiry: the actual Current verifier/Native owner additionally clamps it with its fresh current lease (existing current output expiresAtMs min profile/current/enrollment). Flags SourceAdmission/NativeAdmission/registered/current stay false.

## Original actual verifier branches

Existing deviceFamily/deviceField/deviceOperations now recognize exactly both dedicated purposes and fields. Device profile DATA dispatch, pre-issuer enrollment/profile body validation, actual registered Root/enrollment/profile/current full dual-PQ verification and current-head branches use the same ordinary functions. Each new current head must equal SHA256(canonical signed scope7), with old nonce/sequence/floor/height/status/current/end-window rules preserved. Cross-family/old-purpose/mixed selection and operation reuse are refused. Shared common selection remains exact5: association,expectedRequest,originalHostStatePath,originalHostTerminalDirectory,dedicated scope. No journal selection key was invented: actual Native header projects finalization into the existing query public no-write journal observer under the same directory. Query, provisioning, pending, registered V4, IDE, execution and recovery branches remain present.

## Reusable PUBLIC fixture for parent caller composition

`test/fixtures/finalization-http-v5-source.fixture.mjs` exports createScopeFixtureContext(). It creates real temporary portable mathematical role/device keys in memory and never exports private material. Context methods:

- fixture('finalization'|'http') -> purpose,field,operations,scope,p,e,credentials(...)
- credentials(changeProfile?,changeCurrent?) -> actual independently signed root/enrollment/profile/current strings plus policy,registrations,nonce,previous,at,p,c,e
- context profile/current/preflight(role,c) execute actual original verifier/pre-issuer APIs
- canonical/sha/network/owners/association/registrations/at(100000) for original normal caller PUBLIC seams
- close() destroys all temporary keys; parent MUST call it in finally/after

Keep this helper at the same test/fixtures relative layout in a normal package, or load this candidate's module explicitly. It does not install a Source, expose a signer capability to production, touch real Root/OS keys or grant current qualification. It can be reused to test actual parent Current/Issuance caller imports/fences without repeating the new signature matrix. Finalization fixture's creation expiry30000 is intentionally earlier than profile issue90000/current100000; fresh profile/registered expiry is independent.

## Actual verification and remaining gates

New test/finalization-http-v5-source.test.mjs passed7/7 with actual original ML-DSA-87 AND SLH-DSA-SHA2-256f Root/enrollment/profile/current envelopes. Positive preissuer/profile/current for both purposes and normal read8/identity14 are exercised. Necessary negatives use actually signed wrong body/head/window/ops/selection, gen/op/original terms/registration/nullable key/association/target/cap, separate broken sigmaA/sigmaB, wrong independent Root pin/current nonce/role-key collision, plus getter/Proxy refusal without effects. Expected refusals are retained in raw evidence. No old Source20/41/19 matrix or Native build was run. Strict types exercises unchanged verifier declarations with the two new purposes; parent owns new public scope/factory/caller declarations.

This is code plus PUBLIC mathematical fixture verification, not a real independent Root/registered Source/Native admission, App/OS custody, fresh real account lease, actual local finalization or real HTTP proof. Native original Source/opaque-child/fixedmodule/package closure and Main own branded peer remain separate real qualifications. Empty admission tables remain empty; journal, DATA or a returned public pair cannot make them trusted. UNKNOWN/old account/pending generation and old operations are not cleared, replayed or replaced.
