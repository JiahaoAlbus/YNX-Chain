# Private ProductSession carrier V3 — bounded transport only

The old four-operation transport body/envelope limits are 49,152/65,536 bytes.
Real complete N1 session proof exceeds them. The SDK successor supports an
explicit new carrier without changing Source, Root, enrollment/profile, head,
NativeCore, public registry, response, general Dictionary or verifier frame
limits. No payload marker, parsed object or transport acceptance is a grant.

## Version and purpose

Existing legacy envelopes retain exactly their original five fields and limits.
The new carrier has exactly six fields:
```
{requestId, operation, phase, body, proofHeader,
 carrierVersion:'YNX-PRODUCT-SESSION-PRIVATE/v3'}
```
It is allowed only for beginYNX/handleReturn, phase effect, proofHeader null,
canonical original request V2 and approval V3. Body limit is 196,608 UTF-8 bytes;
whole canonical envelope limit is 262,144 bytes. Time, restore, disconnect,
other versions and other purposes cannot select this budget. No unknown fields,
truncation, omitted signature branch or automatic old-frame retry is allowed.

Browser-safe original client selects the marker for this exact body version.
The protected Node dispatcher and original NodeHost independently use the one
lazy optional provider codec to require N1/index0/empty paths, purpose
PRODUCT-SESSION-APPROVAL, exact owner/network/full public pair and complete
versioned request+unsigned approval message. A valid N2 proof is not a legal
ProductSession proof and is refused; its smaller/larger size cannot change that.
This is structural framing only. Both signature branches and current real
Source policy must still pass the existing required-context engine. Native
association/admission/terminal authority are never supplied by this check.

## Exact SDK locations

- original-wallet-service-private-carrier.js: one browser-safe version/budget
  classification, used by the original client; it grants no authority.
- original-wallet-service-private-client.js request: retains original once-only
  dispatch/unknown/late response rules while selecting this marker only.
- original-wallet-service-private-pq-budget.js: Node-only, lazy optional codec,
  no provider import for legacy inputs and no new crypto implementation.
- original-wallet-service-private-dispatch.js decode: bounds and validates the
  original envelope. dispatch awaits the same Host-owned policy-wrapped sync
  transaction; it never constructs a new server or bypasses Native admission.
- product-session-gateway-node-host.js privateInput and private execution:
  independently checks the same carrier, preserves the original result/journal,
  sync Native APIs and immutable owning readback/terminal/UNKNOWN rules.

## Native supplier change is separate

The current r6a original-auth-identity-node.mm rejects this new marker and size.
Only its original Auth/Native writer may change it. PrivateDispatch's raw read,
canonical exact-key whitelist and AdmissionPrivate's input conversion require
a purpose-specific carrier adapter. The generic Dictionary(env,...) remains
65,536; do not enlarge it for every Source/Root operation. A new private-only
bounded parser must independently enforce the exact new version/operation/body
contract. Keep source/association/peer/current/once-request fences and hash the
complete original six-field input for terminal correspondence. Never drop the
marker from the hash or retry an old consumed request with a new carrier.

The response read/JSON output limits remain unchanged; original Source verifier
input/output, Root/profile/head records and NativeCore qualification frames
remain unchanged. Check any original Unix-socket framing owner for the same
version-limited budget. Existing terminal records carry exact input hashes;
their independent record bounds must not be enlarged just because input grows.

The old binary is not a matching implementation. New Native source/build,
protected source qualification, matching packaged module, actual private
round-trip and independent terminal/UNKNOWN readback remain separate gates.
SDK HTTP/public tests and lexical PUBLIC Native standins prove none of them.

## Measurement and checks

The dedicated test uses the unique provider's actual N1 session proof and a
real N2 proof. It reports exact certificate/member/body/envelope/return URL
sizes in the retained actual-runtime result; request/consent variation remains
bounded by the versioned limits above. The client test transport deliberately
returns a 503 non-grant, never a fabricated Native success. Legacy oversized,
wrong operation/phase/version and N2 carriers are independently rejected.
