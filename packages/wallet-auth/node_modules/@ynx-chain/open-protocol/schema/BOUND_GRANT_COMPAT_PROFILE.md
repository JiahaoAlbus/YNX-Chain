# Bound Grant / Grant Effect public compatibility profile v1

The existing private DATA contract has exactly **20** Grant keys and exactly
**10** step-binding keys. This new public wire does not pretend an older
public Grant encoding was already deployed:

`BoundGrantWire = E("YNX-OPEN/BOUND-GRANT/1", ...all20GrantFields)` has **21**
fields. `GrantEffectWire = E("YNX-OPEN/GRANT-EFFECT/1", fullBoundGrantWire,
fullStepBindingE10)` has **3** fields. The effect step must encode identically
to the grant's complete binding; matching a JSON subset or only the step ID is
insufficient. Provider purposes are the corresponding complete domain tags.
The required original Auth ports are synchronous, await-compatible
`encodeBoundGrant(grant)` and `encodeGrantEffect(grant, step)`.

The private logical version remains `AUTH-BOUND-GRANT-PRIVATE/v1`. Realm,
tenant, Ref kind/id, task/tool/session/target and approval-consent references
retain their original bounded ASCII/UTF8 bytes, never inferred to be raw16
because a string happens to look hexadecimal. The versioned compatibility
profile selects those representations explicitly. Only **newly issued**
grant.id and grant.nonce are canonical lower hex32 in JSON and raw16 in wire.
The original producer must generate them with CSPRNG16; a codec cannot prove
entropy. Old grant IDs/nonces that do not match are rejected, not migrated or
renamed. The existing consentRef remains the exact approvalId.

All U64 fields use eight big-endian bytes; TS/Go DATA integers are strict
decimal strings, never floating point. Bind is E(lengthU64BE, SHA3-512 raw64,
SHA-512 raw64). The schema JSON records the exact Ref/target/tool/session/source
order. Resources are strictly sorted by complete Ref E bytes and unique.
Sources are sorted by their complete Ref E bytes with unique refs. Field masks
are strict UTF8 byte sorted and unique, nonempty, at most 128 UTF16 units and
512 UTF8 bytes, with `*` and unpaired surrogates refused. No NFC, replacement or
silent sorting occurs after consent/signing. The producer may canonicalize a
draft **before** approval, then must retain those exact terms.

The codecs enforce shape and internal realm/tenant/target-service/cap/window
consistency. They **do not** verify a Source, current policy or consent, mint
proofs, allocate budget or dispatch effects. `risk=asset`, `wallet.approve` and
`VAULT` are representable DATA, not permissions. The real original Auth
Catalog/policy and resource boundary still reject asset/Wallet approval under
ordinary grants, deny VAULT egress and require separate current disclosure for
private egress. An ordinary order read is not disclosure permission.

## Existing shared type mapping

The public logical ToolSpec maps `id -> binding.tool.id`,
`revision -> binding.tool.version`, `schema -> binding.tool.schema`,
`aud -> grant.audience`, and `risk -> binding.risk`. Those projected values do
not supersede the original trusted catalog. `receiptType` and handler do not
exist in the private Grant contract and are not fabricated here. The actual
catalog/service owner must select the real handler and validate its receipt.

The private complete step binding is not the same object as the generic
Task Step. Its task/ref revision, generation, stepId, tool, input, target,
sources and holder session are all signed. A resource authority derives the
stable operation slot from GrantScope + task/ref/revision/generation + step +
tool + operation. A replaceable requestId or changed body digest cannot become
a fresh semantic slot. Same-slot changed terms must conflict. UNKNOWN is
reconciled using the original authorized slot and receipt, without releasing
reservation or dispatching again. No operationId route or reconciliation
service implementation is invented by this SDK.

## Runtime and authority limits

The Node `./bound-grant` entry explicitly supports Proxy refusal via Node
intrinsics and has no browser fallback. The Go counterpart is standard-library
only. Existing browser-neutral identity/challenge/framing profiles are intact.
Browser Grant support is not claimed by this first compatibility entry.

Calling types mirror actual original `signBoundGrant` / `authorizeAtEffect`;
there is no public signer constructor, authority root, SQL store or HTTP route.
The authorized-reconciliation type is a requirement, not a ready service call.
Production Source/service startup remains the original Auth owner's gate.

The scoped integration uses the **actual existing Auth policy kernel** with
these real shared wire ports. Source, signer/proof acceptance, persistence and
resource fences in that run are PUBLIC fixtures. It proves shared bytes reach
the existing checks and final resource-callback path, including UNKNOWN and
policy refusals. It does not prove real signatures, a registered Source, an
actual Shop order read or a deployed AI executor.
