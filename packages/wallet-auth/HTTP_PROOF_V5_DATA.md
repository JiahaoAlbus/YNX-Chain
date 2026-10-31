# HTTP proof V5 Node-only DATA/math contract

This independent module implements the specific Root/parent V5 HTTP-proof contract. It does not change V4, supply an active device/Source/Root, expose a signer, issue an execute approval or perform HTTP. Public exports/version/CI belong to the SDK parent. Actual Core typed ABI/Native signing, Auth verification/current/replay and Main durable same-body submission remain their original owners. Empty Root Source rows remain empty. No V4 GET permission is promoted to POST, and no fallback/downgrade exists.

## Fixed contract

Domain is `YNX-PRODUCT-SESSION-HTTP-PROOF/v5`; certificate metadata purpose remains `PRODUCT-SESSION-HTTP-PROOF`. Header is `x-ynx-product-session-proof-v5`.

Unsigned DATA has exactly 23 keys: `version`, `sessionBinding`, `productId`, `clientId`, `applicationId`, `bundleId`, `packageId`, `origin`, `callback`, `account`, `canonicalOwner`, `deviceId`, `deviceRegistrationId`, `deviceRegistrationRevision`, `deviceRegistrationDigest`, `method`, `path`, `bodyDigest`, `nonce`, `issuedAt`, `expiresAt`, `contentType`, `bodyBinding`. Version is string `5`, method only `POST`, path only `/api/v1/ide/deployments`. Product permissions are not inferred in this DATA layer. The original V4 parser is reused on a captured old-field projection solely for all legacy identity/address/revision/nonce/time syntax rules, with internal version `4`; its output is returned as independent V5 plus both new fields. Both original V4 files remain byte identical.

Content-Type must be exactly `multipart/form-data; boundary=` followed by 1..70 `[A-Za-z0-9_-]` characters. No quotes, whitespace variants, CRLF, alternate capitalization or extra parameters are accepted. The DATA codec binds this exact string and does not parse multipart or assert that its boundary matches its body; the original normal HTTP consumer owns actual multipart parsing/order and authentication.

`bodyDigest` remains original lowercase SHA-256 hex64 of complete actual binary body. `bodyBinding` is an exact own DATA record `{bytes,sha3_512,sha512}`: bytes is canonical positive decimal `1..68288512`; both digests are lowercase hex128. Leading zero/number/empty/extra/getter/proxy representations are refused. Whole-body cap is `68288512 = 64MiB + 1MiB + 128KiB`, not the old artifact-only cap. This layer does not invoke the old 64MiB `bindDeploymentV2Bytes` helper.

Message is E6 in exact order:

1. UTF8 domain above.
2. raw U32BE integer 5.
3. raw 32-byte network ID decoded from selected canonical lowercase hex.
4. canonical owner string as UTF8.
5. UTF8 canonicalJSON of complete 23-field unsigned DATA.
6. shared BindE3 from `@ynx-chain/open-protocol/deployment-v2.encodeDeploymentV2Bind`: E(raw U64BE length8, raw SHA3-512 bytes64, raw SHA-512 bytes64). Digest hex text is not used as raw digest bytes.

Message cap is 16384 bytes; raw Member cap 98304; serialized header cap 196608 ASCII characters/bytes; overall headers cap constant is 262144. This module receives only one proof header and cannot measure other HTTP headers; the original HTTP adapter must enforce the complete header budget. It does not alter any old cap.

Header is strict canonical unpadded base64url of UTF8 canonicalJSON containing the 23 fields plus `member` canonical unpadded base64url. Decode rejects malformed UTF8/BOM, noncanonical JSON including duplicate/unknown/escaped/reordered/whitespace representations, padding/alias/tailbits, wrong versions and oversized header/member. Serialization alone does not verify a Member.

## Normal APIs and body flow

The proposed Node-only module contains:

- `parseProductSessionHTTPProofV5Unsigned`
- `encodeProductSessionHTTPProofV5Message`
- `inspectProductSessionHTTPProofV5Data`
- `encodeProductSessionProofHeaderV5`
- `decodeProductSessionProofHeaderV5`
- `inspectProductSessionHTTPProofHeaderV5Data`
- `createProductSessionHTTPBodyV5DATA(actualBytes,exactContentType)`
- `assertProductSessionHTTPBodyV5DATA(actualBytes,exactContentType,unsigned)`

Body builder snapshots the actual Uint8Array using captured typed-array buffer/length intrinsics and native set. Proxy, fake/shared/detached/empty/overcap bytes are refused; own `buffer`/`byteLength`/`length` getters and Symbol.iterator are not executed or trusted. The single owned snapshot feeds all three hashes synchronously. The builder returns `{contentType,bodyDigest,bodyBinding,dataOnly:true,SourceAdmission:false,NativeAdmission:false}`; flags are outside signed unsigned DATA. When constructing unsigned, select only the first three fields explicitly; spreading the builder result into unsigned is rejected by exact-key parsing.

Normal Main holds and durably selects the complete exact body and Content-Type under its original operation/CAS before signing/submitting. It derives the body fields from this actual held body, constructs the complete unsigned, and requests its original authorized Core/Native signer. This DATA module provides no signer. Normal Auth compares actual received body+Content-Type via assertion, and inspects Member/header with independently acquired `networkId,unsigned,pkA,pkB`. A request must not use its own header as a trusted expected pair/request. The assertion recomputes hashes from actual binary bytes; it never accepts a client-provided digest as evidence of the body. Changing the body or Content-Type after capture invalidates the proof; body bytes and their durable transport remain caller-owned.

Math inspection enforces certificate N=1, Member index0, both empty paths, correct purpose/owner/network, full exact selected public pair, and complete message bytes. It then uses the same original complete AND verifier as V4, with a local DATA-only owner adapter and no cache. Both ML-DSA-87 and SLH-DSA-SHA2-256f signatures must pass. Result reports `signatureVerified:true,dataOnly:true` and `trusted:false,authorized:false,registered:false,current:false,nativeAdmission:false`. This verifies math only, not Root trust, registered device, Source, current authority, HTTP replay, execute grant, deployment effect or finality. The <=30s window is legacy syntax; no ambient real-current assertion is performed here.

## PUBLIC Core interoperability fixture and focused verification

`test/fixtures/product-session-proof-v5-public.json` is a PUBLIC, freshly generated binary-body/Content-Type/23-field unsigned/E6 message/Member/header fixture with independent network/public pair. It also carries original V4 unsigned/message bytes, a genuine two-message Member and a signed wrong-purpose Member for refusal. The body contains manifest/approval/artifact-ordered synthetic multipart DATA with invalid-UTF8 binary bytes; it is not a real E11 deployment manifest or real execute approval. The temporary mathematical keys lived only in memory and were destroyed; no private material, real account, Native, network, Source or funds were used.

The checked-in generator is explicit test tooling and must not run as a production signer or automatically regenerate frozen vectors. It uses the original portable batch primitive, Buffer snapshots for its native test API and no changed math.

New tests cover actual body binding and maximum 68288512 bytes (including bytes beyond64MiB), E6 raw ordering, valid complete AND, each signature independently broken, independent network/pair/request mismatch, N2/purpose refusal, strict header/canonical/cap cases, hostile capture and V4 byte equality/strict V5 refusal. Old V4/Core/Native/HTTP matrices were not rerun. Public package export and actual Core interoperability acceptance remain parent/Core gates.

## Final actual path correction

The first short-path candidate and its fixture pin7526d1c46684c8e4f0845cfd45bd1a262a48c342a6e77be5ed76a784754bb0fa remain frozen in their original directory as first-candidate evidence. This successor signs only `/api/v1/ide/deployments`, the original final URL pathname. P04 actual `apps/cloud/sdk/index.js` endpointURL adds `/api/v1`, and deploymentHeaders captures the resulting URL pathname. `/ide/deployments` is only the original product-relative input and is rejected as a V5 signed path. No strip, prefix mapping, alternate route, redirect or Cloud service/client change is introduced. The new PUBLIC golden was genuinely re-signed with ephemeral in-memory keys; it was not produced by editing unsigned JSON alone. Its V4 unsigned/message compatibility bytes are retained exactly from the first candidate.
