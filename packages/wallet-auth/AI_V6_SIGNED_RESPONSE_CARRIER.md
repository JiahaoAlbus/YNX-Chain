# Paired AI V6 original response carrier

The existing response16/E5 signature commits to the exact HTTP transport body.
This successor uses a canonical JSON object with exactly four keys:
`version`, `bodyOriginalBase64url`, `outcomeMetadataOriginalBase64url`,
`businessReceiptOriginalBase64url`. The version is
`YNX-AI-TASK-V6-RESPONSE-ORIGINALS/v1`.

All byte strings use canonical unpadded base64url. The receipt is nullable:
`null` means absent, while `""` means a present empty original. Its opaque Go
bytes are never parsed, reordered, replaced with a hash, or synthesized from
the response state. Metadata is the canonical original exact five fields
`state`, `action`, `businessAction`, `completionScope`, `requestRef` from the
same original business outcome. The original business response bytes remain
unchanged inside the carrier.

The entire carrier must fit the existing response16 1,048,576-byte limit.
Metadata is bounded to 16,384 bytes; individual body and receipt are bounded
to 1,048,576 bytes. Base64 overhead counts toward the transport limit. An
otherwise permitted business body may exceed the aggregate bound. Reject
without truncating, regenerating a nonce, signing a replacement response or
replaying an effect; preserve the same once/receipt/UNKNOWN and original cause.

The server obtains the actual durable outcome/receipt before encoding and
signing. The client verifies the original response issuer, full pair,
request/op/nonce/current/window and the transport digest before treating
decoded receipt bytes as part of a genuine authenticated outcome loan.
Decoding alone returns DATA with all authority/provenance flags false.
Metadata/receipt action, completion scope and same-operation semantics still
use the original Auth and SDK outcome validation. No new endpoint, signature
domain, proof field or Root grant is created.

The public Client7 and Observation24 retain their existing meanings:

- `Observation.bodyOriginal` is the original request body.
- `responseOriginal.bodyOriginal` is the complete raw HTTP carrier, paired
  with its actual status, headers and completion fact.
- `responseDeclaration.bodyDigest/bodyBytes` commit to that outer carrier,
  never to the unpacked business body.
- The inner business response is available from the sole decoder and the
  matched authenticated outcome implementation. No new public field is added.

Journal/recovery retains exact transport, signature/member, original receipt
and original operation/nonce. Old untagged responses and old r2/r4 consumers
are not silently upgraded or mixed. Auth/Native must consume the matched
successor. The C++ decoder reuses the existing single `MobileCanonicalDATA`
implementation from `native/ai-v6-codec/inherited`; do not compile a second
copy into the same Native image. This package contains no Root admission,
signer, HTTP producer, Native provider or real business success.
