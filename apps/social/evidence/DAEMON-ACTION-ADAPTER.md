# Owned daemon action adapter

Main now injects the owned MatrixAudienceActionVerifier adapter. It calls the
approved shared VerifySocialAudienceProof with the original action header,
verified Session, HTTP method/path, exact raw body and server clock. It converts
only Nonce, BodyDigest, SessionBinding and ExpiresAt. No key or signature domain
is created; BrowserBinding and durable nonce/current-actor/policy/intent checks
remain under the existing Social server and service. Server scopes must be the
exact four route scopes, without duplicates; malformed server policy is 500,
invalid proofs are the original shared typed failures. Cancellation stops work.

Dependency: shared 45de8d4f11737ccf5ee2a349be6717cb3ce77bbd action API,
included in approved composed shared 3c21813a99b6fd402dcd8f9c0ac7e84cf441682c.
The owner checkout still has older shared code: its ordinary daemon compile
fails for missing symbols. That original failure is retained, not called pass.
No shared implementation was copied into the product checkout.

Regression used a read-only Go overlay referencing A's existing immutable
composed archive. Every overlaid production Go file was hash-object checked
against the exact shared 3c218 Git blob before execution. No candidate build,
Host, vendor or shared-file mutation was performed. Overlay metadata and source
blob list are retained under `daemon-action/20261002`. These paths are local test
references, not deployment configuration or a durable production carrier.

Actual daemon race passes: unchanged shared JS-signed public test proof produces
the exact receipt; raw-body whitespace/substitution and device substitution
reject; duplicate/missing/invalid proof, duplicate/widened route scope and
cancelled context reject. The source-only public signed fixture is copied
byte-for-byte into owned testdata; it contains no signing private key.

This is not a live Session authorization or production transaction. Revalidator
injection still requires A's separately frozen protected file loader and
registered backend-key contract. No second loader/key was created. A must compose
the exact owned successor with approved shared and independently build/review
before any separately authorized release. Actual HS/RP/existing-MXID and public
or installed consumer-to-authority lifecycle remain unverified.
