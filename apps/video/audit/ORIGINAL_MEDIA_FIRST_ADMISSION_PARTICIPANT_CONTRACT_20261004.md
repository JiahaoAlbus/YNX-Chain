# Media original mapped participant: first admission composition

Owned source ed1111b0498d59b0ca7b9a8e0f0a2d72d8bac5cf / tree 0d462674b754e3ed071e8313f6f08b03598f1362, six-path increment after adf7d6d6e2087a6f7b3c58f1318f3442cd6e49fa. All e678/adf operation/provider work and earlier failures remain intact. This supplements the existing transaction and operation association contracts; it does not replace the original Store, nonce, provider or source identity.

## Exact two-leaf shared composition

Only internal/productsessionv2/original_effect_participant.go and _test.go from original-effect-node-commitment-successor-c5-20261004 are added to the current inherited331 source assembly. Manifest df0e45784ac97936bcc2ff7316d2f94434b6052a9b808dcb1eec1c076e7c5124, archive108035B/58 regular members SHA6beec8686f805b4fb11b6421cee962d94fa5721b81504c43e4c38dfad755046b. All78 listed frozen files and all58 archive members verified. Root review REPORT SHA3f8e1c545d90d4c4a0fb60e01d65d5a1b450f979da9510c4150a639aed3971f8 is LIMITED_SOURCE_PASS only. Its unchanged expiry probe1PASS is Root evidence, not rerun or claimed as owned execution.

No old52 context source/root module/accountaddress overwrite occurs; inherited a5 SSO, coordinator959, current Media mains and owned state/provider code remain byte-identical except declared six owned files. Complete new matching source has337 files:331 +2 exact Shared leaves +4 owned adapter/test leaves. The old0e63/70 HOLD/FAIL and old ambiguous RequestDigest semantics are retained, not composed or relabelled green.

## Actual original identity namespaces

The source successor distinguishes `OriginalEffectOperation.ID` (owned operation key) and `NodeOperationID` (original Node44 ID). Media's existing `OperationID` remains the original Node ID used by its internal journal index. New `OwnedOperationID` preserves the separate exact `op.ID` as an optional omitempty field. The two are NEVER assumed equal or derived from one another. Prior metadata with missing OwnedOperationID remains unchanged; a legacy missing value cannot be reconstructed as a genuine full participant mapping.

`NodeRequestDigest` remains the original Node full-effect commitment. `ActionBodyDigest` remains the actual original grant/action body SHA256 and must equal Shared WireDigest. Original outbound provider WireDigest remains separately recorded under Providers/Music effects; it is not confused with inbound action or Node commitment. All tests deliberately keep the Node/owned IDs and Node/action digests different.

## New owned backend-only first-admission API

With ynx_canonical_media + ynx_media_combined_authority:

- `PrepareOriginalVideoParticipant(g VideoBusinessGrant, p *productsessionv2.OriginalEffectParticipant) (VideoLocalTransaction, VideoOriginalOperationMetadata, error)`
- `PrepareOriginalMusicParticipant(g MusicBusinessGrant, p *productsessionv2.OriginalEffectParticipant) (MusicLocalTransaction, MusicOriginalOperationMetadata, error)`

These consume the SAME already verified original grant and participant supplied by protected startup/request composition. They do not create a mapper, reservation, reader, registration, signer, grant, ID or result. Missing p/Current/Revalidate returns original typed unavailable. They obtain a detached complete OriginalOperation and require:

- Exact actor/product/session binding/action nonce and expiry.
- Original action/grant BodyDigest == ActionBodyDigest == WireDigest.
- Exact original fixed route Scope retained in complete Session scopes. Video accepts only video/creator-studio, Music only music; this consistency check does not replace the mature fixed-route signature verifier.
- Video's original full SessionExpiresAt equals complete original Session expiry.
- Original Node ID and Node commitment have their actual64-lowercase-hex encoding; owned ID is independently retained, bounded and not empty.
- Any previously supplied Operation metadata equals EVERY resulting field; no silent remapping, old-ID alias or current grant attachment to legacy UNKNOWN is allowed.

Caller installs the returned detached metadata on the SAME original grant, sets RequireOperationAssociation=true, and returns the prepared transaction from CaptureTransaction for FIRST local admission. The adapter invokes p.Execute, receives its marked local context/full detached original operation, checks full unchanged equality and synchronously enters the existing original Store callback. Existing guard/nonce/object/member/current/cancellation/audit/fsync behavior remains in that callback. Errors join the Shared UNKNOWN error with the original Store error, preserving context/uncertainty rather than implying rollback. No result from reservation/commit is exposed as terminal.

Existing Node UNKNOWN/TERMINAL admission is readback-only and invokes no product callback. Adapter returns typed unavailable for that no-entry result instead of a successful business write. It does not dispatch, rename an operation, release private data, consume a product nonce or create a fake terminal receipt.

## Original first-admission/bootstrap ordering

A's actual protected composition remains responsible for constructing fixed capabilities ONCE from genuine sources:

1. OriginalNodeReservation(port, fixedMapper) and AuthenticatedOriginalReadback(port), with real installed source custody/authentication. Constructor success is not provenance.
2. Original mature VerifyVideoBusiness/VerifyMusicBusiness + exact full Session/action/retained raw route bytes; original Revalidate after awaits OUTSIDE gate/Store. Web retains its exact approved BrowserGrant; nil is only for genuinely non-Browser original flow.
3. NewOriginalEffectParticipant on the SAME registered authority coordinator/full original materials and ORIGINAL owned ID. The fixed mapper must supply the original Node mapping without changing ANY Session/action/nonce/route/body/context field.
4. PrepareOriginalVideoParticipant / PrepareOriginalMusicParticipant; install exact returned metadata and first CaptureTransaction as above.
5. Original participant durably admits Node UNKNOWN before the ORIGINAL product Store commits its first nonce + actual business + audit + mapping + original provider commitment. Actual durable/authenticated Node topology is a producer obligation; the owned test models demonstrate ordering only.
6. Subsequent local persistence phases within the SAME scoped original lease require fresh coordinator captures using the SAME full original Session/BrowserGrant/current/actor source. They keep the same Node/owned mapping and original nonce; they MUST NOT re-execute participant/new reservation or choose a new Node ID to redispatch. Provider network calls remain outside the gate/Store; existing UNKNOWN no-retry and submission-only receipt meanings remain.

Concrete bootstrap gap: Shared constructor needs genuine original product↔Node association BEFORE the first product commit. A cannot use Media's as-yet absent first-operation journal as a self-issuing mapper, insert an extra fake product admission before signature/nonce, or call the Store getter recursively under source/gate. Supply original Node writer's authenticated captured association/read-only immutable publication or actual participating original topology. A network mapper/reservation is not eligible inside this synchronous gate. This debt is NOT an invitation for a caller hash/marker, a human API definition or a new Store writer.

No production bootstrap variable is assigned here. Original mains remain unavailable without actual fixed producer, original registration/current/enrollment/actor, mapper/reservation and reader sources. This ordinary source composition is independently buildable, not an installed release.

## Original outcome/recovery ports

The prior `ReadOriginalBusinessNonce`, Music `ReadOriginalBusinessEffect`, `ReadOriginalBusinessOperation`, and Video `ReadOriginalBusinessOperationResults` remain original same-Store, integrity/disk==memory, detached exact expected-identity read ports. New OwnedOperationID participates in exact identity comparison. Music includes original sorted effectKey/receipt; Video includes actual original payout/AI result plus actual persisted outbound commitments. Existing missing association stays typed unavailable, never not_executed.

A's fixed authenticated readback producer must keep the complete original persisted Shared operation, including distinct owned/Node IDs, complete old Session/action/expiry/browser context and all commitment namespaces. It must independently authenticate original account/device/registered reader/provider and verify genuine final/reconcile evidence. The owned reduced grant/journal alone cannot reconstruct a complete signed Session or attest terminal provenance. Map original operation identity precisely to owned read ports; do not call them from recursive Store/source callbacks. Recover uses a fresh READ-ONLY context with exact original operation, not a current-proof/session renewal or a new action attached to old ID.

Pay awaiting_wallet_confirmation, Music Trust ACK{id}, local AI result, matching disk bytes, no receipt, cancellation and timeout retain original semantics. These helpers produce no authenticated TERMINAL, committed/not_executed/receiptDigest schema, provider finality or retry permission. Real final/reconcile and expired-session independent registered recovery proof remain A/provider implementation debts.

## Actual checks and acceptance limits

Only affected16 owned tagged targets (12 prior association targets +4 new participant Store integration targets) and12 owned default compatibility targets are run, plus two owned tagged vet targets and both original backend builds. No inherited Shared model suite or Root expiry probe is repeated. New Native Session tuple tests are explicitly derived software models using public fixture device fields; no updated signature, real enrollment, hardware/device approval or authenticated durable Node producer is claimed. Actual original product persistence/cold restart/independent IDs and commitments/first UNKNOWN ordering/two local phases/legacy UNKNOWN no entry are exercised.

Real fixed producers, Node↔Go atomic reservation topology, auth/current/enrollment/private-generation/actor feeds, provider-final/recovery producer, Host installation reconciliation/readback, existing unlocked Wallet/native本人业务 and release acceptance remain NOT_SUPPLIED/NOT_VERIFIED. Candidate darwin-arm64/local unknown binaries are not formal installation or deployment.
