# Mounted audience routes and schema 7 source checkpoint

Both POST routes are now mounted in the existing Social Server:
`/social/v3/matrix/audience/resolve`, `/social/v3/matrix/audience/authorize`.
This is source integration, not a live/public permission or E2EE receipt.

Resolve exact JSON fields: kind=contacts|group|selected|private; optional
selected (1..255 existing opaque sp_ IDs, selected only); optional groupId
(existing original group owned by actor, group only). Owner/MXIDs/room/revision
are never caller inputs. Contacts use original accepted Contact.Left/Right;
blocks and group membership use the original persisted state. Exact existing
directory bindings are mandatory, with no account/MXID creation fallback.

Authorize fields: action=publish|comment|media-prepare|index|read,
transactionId (16..128 ASCII alphanumeric/underscore/hyphen), expected (exact
resolved protocol/kind/revision/owner/roomId/members); optional eventId for
index and parentEventId for comments. Index validates an observed encrypted
event's room/ID/sender/original transaction and stores metadata only. Original
parent must have a matching original index. Actual decrypted semantic payload
validation remains in the Matrix consumer, never plaintext in Go state.

Both routes require exact sorted scopes social.contacts/social.feed/
social.messaging/social.profile, current live session, and original browser
Origin/CSRF binding (Native mode remains proof-only, not browser-bound).
Strict bounded UTF-8 JSON rejects duplicate keys recursively and unknown
fields. Rate limits and session/deadline bounds remain in place.

IMPORTANT shared-owner clarification: existing introspection proof signs the
introspection request, not business JSON. The mounted routes therefore also
require Config.MatrixAudienceActionVerifier.VerifyHTTPAction for the same
live device/session/method/path/exact body/scope set. With no real verifier,
they return 503 without executing store operations. HTTP tests use an explicit
synthetic verifier; they are not signed action-proof acceptance.
Duplicate/missing action headers are rejected before that verifier. Its receipt
is metadata only: Nonce/BodyDigest/SessionBinding/ExpiresAt, from the existing
shared domain, not a new signature format. Exact body hash, live session binding
and session expiry are cross-checked; browser grant digest remains separate.

Config.MatrixAudienceAuthority is also mandatory. Its trusted production
adapter must observe real encrypted rooms, exact confirmed JOINED members and
joined-only history visibility, and read real HS encrypted-event receipts.
Default daemon config does not supply it. A caller boolean or member list is
not this adapter. Current tests use a named synthetic authority; they do not
prove HS membership, Rust encryption, actual event receipts or revocation.

Schema 7 adds AudiencePolicyRevision, MatrixAudiences, RestrictedMomentIndexes
in the same original atomic/HMAC-protected file. Original save/rollback helper
advances policy epoch for original contact/block/group/public-ID mutations;
remove-and-restore cannot revalidate an old revision. Room confirmation is
rechecked after await under the existing mutex. Uncertain storage rejects new
bindings/index and replay; original data and post-rename latch remain retained.
It also stores MatrixAudienceNonces and monotonic AudienceProofTime in this
same file. A durable prepared intent consumes (SessionBinding,Nonce) before
room observation/provisioning or event reads, carrying original selection or
event/parent intent, txn/action/body/actor/browser binding/audience. Binding/index
and completed status then commit together after current policy checks. Failure
or crash leaves prepared/unknown intent; same nonce cannot repeat observation
after restart. Completed expired entries may be pruned; unknown intents are not
pruned by expiry. A bounded ledger and clock-rollback rejection remain fail-closed.
Protected unknown-intent recovery UI/settlement is not yet implemented; records
are retained rather than claiming an unknown side effect was undone.

New fields are omitted when absent, preserving original schema 1..6 HMAC
encoding before migration. Existing schema6 read-only checks retain reader6
eligibility when no new fields exist. Startup upgrade writes schema7, after
which old readers must be refused. No actual product state was upgraded here.
Production writer startup/upgrade requires a separate Central data/deployment
lease. Run state-check with target reader7; mutating actions still require
--writer-stopped. Rollback UI/artifact only with a schema7-compatible daemon,
retaining the current file and local integrity key. Never downgrade/strip new
fields, replace current state with an old snapshot, or run a schema6 daemon
against schema7. Historic schema6 instructions are superseded for new files.

Remaining full product work: real shared action verifier, real HS observation/
room provisioning adapter, actual client action proof and UI adapter, encrypted
attachments, protected durable drafts, feed/index rendering and relationship
reconciliation/key sharing, mature Native bridge and independent devices,
public/installed/dot acceptance. Pre/post checks are NOT atomic remote HS
revocation. Existing legacy plaintext Moments/media and all old keys/history
remain unchanged; this checkpoint never relabels them as encrypted.

Regression history retained: first run failed four schema6 expectations after
schema7 introduction; source gates and tests were updated to preserve original
eligibility while requiring reader7 after upgrade. A later HTTP grant test was
rate-limited (429); only fixture rate budget increased to isolate its 401 grant
assertion. Production rate controls were not changed. Semantic JSON field
order negatives now compare exact typed key sets rather than insertion order;
unknown keys, changed values, sender/shield/parent failures still reject.
