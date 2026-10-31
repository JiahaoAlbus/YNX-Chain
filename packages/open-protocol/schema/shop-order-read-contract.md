# Shop selected order read DATA profile

Read-only actual P07 source: `/Users/huangjiahao/Desktop/YNX Final Worktrees/63-shop-connect-state`:

- `internal/commerce/server.go`: normal POST `/api/tools/shop.order.read` route.
- `internal/commerce/task_order_read_original_auth.go`: sole original product
  `OriginalShopTaskOrderCodec` interface and checked resource adapter.
- `internal/commerce/shop_order_read_tool.go` and
  `shop_order_read.input.schema.json`: actual input/schema/tool descriptor.
- `internal/commerce/task_order_read.go`: response content types and diagnostic
  fence header, default NOT_ADMITTED when original operands are missing.
- `internal/commerce/order_projection.go`: exact nine allowlisted fields and
  whole-order SHA-512 snapshot; no payment finality or permission from status.
- `packages/auth-grant-policy/go/task_grant.go`: original TaskEffectBinding,
  Proof and held Source/effect checks, not a public WIRE.

The input schema bytes here are copied unchanged. Tool ID and operation are
`shop.order.read`, version `1`, purpose `read-selected-shop-order`, risk `read`.
Schema Bind covers the original schema bytes including whitespace/newline.
Input bytes are the exact original JSON `{orderId,fields,snapshot}`. Unknown and
duplicate keys/trailing values are refused. Fields must be sorted unique members
of the nine-field allowlist; snapshot is lower hex128; orderId is nonempty UTF8
at most 256 bytes (matching the actual Go reader bound). Producers serialize in
that key order, no HTML escaping, escape U+2028/U+2029 equally across Go/TS.
Decoders retain and hash original input bytes: key order or whitespace changes
produce a different Bind even if the selection DTO is equivalent. Unpaired
surrogate escapes are refused instead of silently replacing identifiers.

Initial missing physical contract (not implemented or called existing WIRE):
normal request envelope over TaskEffectBinding + opaque Grant/Holder proofs;
normal response envelope and precise SourceBytes representation. The only
existing implementation is explicitly PUBLIC fixture codec, not production.
The P07 encoder receives `(ctx,projection,source,scope)` with no per-call opID or
remoteRef; no concurrency-unsafe request memory or generated references may fill
this gap. Parent sole OPEN must resolve the new transport profile before encoding.

DATA ports never sign or verify proof, supply Source/current identity, authorize
buyer/seller/model disclosure, allocate an operation, mark COMMITTED, or claim
atomic remote revocation. Original UNKNOWN and same semantic operation remain
with the protected authority/durable caller. Schema/type correctness is not
registration or service admission. Old shared Grant/identity/Cloud bytes remain
frozen. Core-first, old-website freeze, no-fast and original owner boundaries
apply to actual agent `/root/open02_codec`.

## Implemented private DATA mapping

Parent requested the independently determinable input/schema/Binding/proof
module while coordinating the normal wire with P07/Auth. See
`shop-order-read-primitives.json` for exact E21/E3 physical DATA mapping; this is
not a declaration that a complete request/response transport is frozen.

`encode/decodeShopOrderReadBindingDATA(bindingOrWire,inputOriginal,expected)`
requires `expected={target,orderKind}` from an independent original registered
selection, validates fixed P07 tool/schema, exact input bytes Bind, same selected
resource/ref/revision/fields and structural scope. It never decides whether that
revision/task/epoch/account/channel is genuine, current or allowed. A consistently
changed revision is another possible DATA value; only original proof/Source and
the original independent operation selection can authorize it.

`encode/decodeShopOrderReadProofDATA(proofOrWire,expectedPurpose)` preserves raw
payload/wire bytes and refuses JSON grant/approved/verified objects in their
place. The explicit expected purpose must be supplied by the real owner; it is
not inferred from an untrusted proof. Proof byte shape is not signature validity.

Public `sources[].ref` maps exactly to private `Source.Resource`; `ref.rev`
maps exactly to private `Ref.Revision`. Source/field sets do not authorize egress.
Raw channelBinding is private DATA, not a trusted transport digest from HTTP.

No full HTTP request factory or response decoder is published yet: the original
P07 encoder interface lacks per-call originalOpID/remoteRef; authoritative values
must come from genuine Auth durable selection and the actual resource Source.
The SDK does not remember a previous request to fabricate those values. The
PUBLIC test source-bytes encoding json.Marshal(projection.Data) is only a
candidate until original P07/Auth approve the actual preimage. The module neither
changes product interfaces nor installs a second verifier, Source or authority.

Proposed parent public subpath (not written):
`./shop-order-read` -> types `./src/shop-order-read.d.ts`, import
`./src/shop-order-read.js`. Go requires the already identified standard
crypto/sha3 toolchain >=1.24; parent owns go.mod and exports/CI changes.

## Subsequent complete new request/response DATA contract

The historical gaps above are retained as first cause. Parent sole OPEN then
supplied the exact new E5 request and canonical JSON result DATA contract, with
Auth's formal purposes: Grant `YNX-OPEN/BOUND-GRANT/1`, Holder
`YNX-OPEN/GRANT-EFFECT/1`. `shop-order-read-transport.json` now defines the complete
implemented DATA profile. This does not claim an earlier production wire or that
P07's missing normal codec adapter/Source has been installed.

`encodeShopOrderReadRequestDATA(call,expected)` encodes exact E5;
`decodeShopOrderReadRequestDATA(wire,expected,actualContentType)` requires the
actual fixed MIME `application/vnd.ynx.shop-order-read.v1`. Its independent
expected target/kind remain mandatory. The normal P07 adapter still checks the
real method/path/channel and calls the original verifier. DATA decoding validates
both original signed payload shapes, byte-identical inner Grant and all shared
TaskEffectBinding terms, preserving raw signature bytes. It does not verify their
signatures. Auth/LINK outer channel must never overwrite the inner signed
`holderSession.channel`; the current codec cross-binding refuses that mismatch.

`encodeShopOrderReadResponseDATA(value,expected)` and
`decodeShopOrderReadResponseDATA(responseOriginal,expected)` take independent
`expected={selection,source}`; source uses exact original `{resource,fields,label,
binding}` with `resource.rev` mapping private Revision. They return owned original
response/source bytes, both dual Binds, the declared Source/projection/fence and
literal `dataOnly:true,sourceVerified:false,operationVerified:false`. No operation
ID, remoteRef, COMMITTED or verified=true is added. A diagnostic authFence value
is still declared DATA, never proof of a global or current protected fence.

SourceBytes is now explicitly the NEW contract
`UTF8(canonicalJSON(projection.data))`. The exact requested nine-field subset is
required with only string values. P07's money fields are existing decimal strings,
status/currency existing strings, and its three time.Time fields must first use
the original JSON RFC3339 string values. The codec does not invent timestamps or
payment finality. Canonical JSON matches the existing SDK sorted-key/
JSON.stringify string rules, including no HTML escaping, no Unicode normalization
and no confusion between a literal backslash-u sequence and a genuine U+2028.

Actual original reserve operationId, original grantRef/expectedRevision, and
verified originalOpID/remoteRef require the original Auth/P07 protected Node/
LINK/verifier bridge. No formal callee/Source for those effects was supplied in
this module; they remain false. P08 must correlate those genuinely verified
operands to its durable selected call, not copy unverified response or headers.
Codec construction never retries, releases UNKNOWN budget, starts a new slot or
turns changed nonce/request/path/generation into proof of the original operation.
No generic injected authority/provider, Source, signer or management endpoint is
introduced. Parent remains sole public package/exports/go.mod/CI integrator.
