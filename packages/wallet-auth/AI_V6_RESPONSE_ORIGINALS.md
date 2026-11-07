# V6 response originals: independent business outcome required

The existing sole response carrier remains
`x-ynx-product-session-response-proof-v6`. Reuse
`native/ai-v6-codec/MobileAITaskV6HeaderDATA.hpp::decodeResponseHeaderDATA` and its
unchanged canonical16/E5/Member representation (formal header-r2; e2e79efb).
This module creates no new HTTP field, response body envelope, domain, nonce,
algorithm, signature or business-completion state.

## Actual producer and custody chain

SDK `src/original-ai-task-action-v6-client-private.js:111-124` first retains HTTP
body/header, verifies independent response issuer/math/binding and then calls
`fixedSource.acquireOriginalAITaskActionV6Outcome(SAMEpeer,SAMEctx,response)`.
That source must own the original durable business receipt. It reads metadata via
`readOriginalOutcomeDATA()` exact5 state/action/businessAction/completionScope/
requestRef and bytes via `readOriginalBusinessReceipt()`; response state is only
a declaration, not that receipt.

Actual server producer `task-action-http-v6-private.mjs:55-80` calls
`source.captureOriginalTaskActionV6Outcome(req,body,status)`, reads its held outcome
and stores the original receipt in its same once SQLite namespace. It emits HTTP
`{header,unsigned,bodyOriginal}` only. Neither HTTP headers nor the ordinary
business body contain a general metadata5/receipt carrier. The original once
getter `task-action-once-v6-private.mjs::readOriginalBusinessReceipt` is explicitly
persistenceOnly; its row is not by itself a Root/current grant.

Actual private business source
`task-action-business-request-v6-private.mjs::captureOriginalTaskActionV6Outcome`
returns the SAME independent retained child with readOriginalOutcomeDATA and
readOriginalBusinessReceipt. Its LINK `lookupOriginalOutcome` uses the original
same-private-loan `outcome` operation, not a public HTTP query/provider.
Auth Go `OriginalTaskStateReader.CaptureOriginalOutcomeDATA(ctx,principal,op,
requestDigest,action)` retains `HeldOriginalBusinessOutcome`, whose Current and
ReadOriginalOutcomeDATA obtain actual P08 durable originals. P08's
TaskStoreSource.CaptureOriginalActionOutcome checks original principal/op/E5
request digest/action/key and persistent committed body. TaskActionOutcomeReceipt
Current/View/Body/Close owns the exact product-local original and read-only
lifetime; it is not permission to execute tools/models/funds or reactivate an old
holder. Successful writer epoch changes use original-operation outcome authority,
not stale writer current. UNKNOWN never reissues SIGN/SUBMIT.

Go `originalBusinessReply` private carrier is exact5 handle/kind/metadata/
bodyOriginal/receiptOriginal, with the two byte fields base64.RawURLEncoding.
Outcome metadata has11 fields, observation metadata8. This Go struct ordering is
not canonical sorted JSON; the existing MobileCanonicalDATA parser must NOT be
passed that whole carrier. The original Node source already parses it under its
private registered runtime, retains the opaque handle, checks expected digest/
body and returns metadata5 + raw receipt from the SAME held source. It is not an
ordinary remote HTTP receipt transport. No second JSON parser is added here.

## New implemented DATA helper

`native/ai-v6-response-originals/AIResponseOutcomeOriginalsDATA.{hpp,cpp}` adds
`copyAIResponseOutcomeOriginalsV6DATA(privateMetadataExact5,privateReceiptRaw,
responseBodyOriginal,independentResponseBinding)`.
It reuses the original Auth MobileCanonicalDATA parser and originalSHA256 ABI,
checks exact5/type/state/action/requestRef/body hash/length and copies all original
bytes. RequestRef is optional with explicit presence; null and empty are distinct.
The receipt is opaque original Go struct serialization: never parse, sort,
rebuild, compress or hash it as a substitute for its real held owner. Output
flags responseProofVerified/receiptProvenanceVerified/completionSemanticsVerified/
RootAdmission/SourceAdmission are ALL false. The original Auth
MobileAITaskClient::acquireOutcome independently applies its actual response N1/
issuer/current and action/business completion-scope semantics after adoption.

The LINK HTTP carrier's2MiB ceiling and actual Auth consumer's1MiB limit remain
separate. Any response over1MiB is accurately refused as unsupported by Auth;
no truncation/drop/claim of2MiB Auth support. Receipt cap1MiB, metadata cap16KiB.
Native must retain raw response and partial owner BEFORE calling this DATA helper
or checking late current/error, and drain the same original child/parent on all
failures. This pure synchronous helper neither owns nor clears cleanup debt.

## Missing actual Native callee, not a DATA placeholder grant

The inspected actual `OriginalMobileAIClientRoot` has copyServerCurrentDATA/
copyServerEvidence but no durable-business-outcome borrowing member. The new LINK
HTTP sender Packet only supplies HTTP status/headers/trailers/entity. Therefore
Native `ynx_ai_mobile_response_read_v6` cannot yet fill its business_receipt_original
and outcome_metadata_original from that Packet. Auth must bind the existing
independent Source outcome port to the genuine original Root/current/private
business loan with SAMEpeer/context/op/nonce/E5 request digest/ref/registered
issuer/response body. The actual original Go/P08 getters above are reusable,
but they are not already a remote HTTP or Native client port.

No new ABI name/provider is invented for this missing strong bridge. The required
existing Source method is acquireOriginalAITaskActionV6Outcome; its concrete
Native borrow/body remains NOT_SUPPLIED. `requireAIResponseBusinessOutcomeSourceV6`
throws that precise missing-source error even if HTTP200 or signed COMMITTED is
present. It does not implement a replacement factory. Real Root/Native/protected
Source/transport/business acceptance remain false. A later actual source owner
may use this helper on its real copies; passing public DATA is never admission.

## Verification and normal supply

12 new PUBLIC C++17-Wall-Wextra-Werror controls, using exact original Auth parser/
header fixtures and PUBLIC host SHA adapter, passed. No existing Native/Go/
cryptography matrix, image, real sender, key, service, account or approval ran.
Normal runner `python3 packages/wallet-auth/scripts/ci/ai-v6-response-originals.py`
uses private mkdtemp/finally cleanup, Mac CommonCrypto or Linux OpenSSL PUBLIC
adapter. Production depends on the original Auth ABI, not a test crypto copy.
