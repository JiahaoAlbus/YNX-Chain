# Encrypted indexed feed read path

GET /social/v3/matrix/audience/indexes returns metadata only. It uses the
original live Product Session and BrowserSSO/generation, fresh confidential
reader, original current-audience policy and real HS room/event observations.
No body, key, access token, ciphertext, identity creation or send is introduced.
Configuration absence and revoked/stale authorization remain fail closed.

The service uses the original confirmed restricted indexes, rechecks current
policy around awaited observations and before returning, and validates the
original room/event/transaction/sender/encrypted event type. Current accepted
friends can read. Deleted contacts are excluded before any HS observation.
Reads do not replace or delete durable indexes after transient failures.

The actual HTTP client validates bounded metadata/cursor and captured view,
requires existing explicit publishing permission, and does not silently approve
or fall back to plaintext. RestrictedMoments.read checks original authorization
before/after SDK messages, sender, indexed event, semantic audience/revision and
comment relation, then returns only the authenticated decrypted content.

Evidence in feed-read/20261002: original service/durable-state tests with
controlled HS pass for metadata, accepted friend/deleted contact, authorization
revocation at three boundaries and sender substitution. Five actual HTTP client
cases pass with controlled fetch/session. Six original service metadata ->
actual HTTP parser -> actual RestrictedMoments read/publish/read cases pass with
controlled SDK/authority, including exact original comment transaction and
rejecting the wrong txn argument without dispatch.

Initial fixture failures are retained: wrong action publish-index (real action
is index), nonexistent state Profiles field, omitted SDK getMembers and wrong
record/semantic envelope. Corrected fixtures reuse the original service actions
and peer, not manually forged production state. Those were harness defects.

Go full Social/daemon race passes using the previously documented approved
shared3c218 read-only overlay. Npm111 and typecheck pass in the owner workspace,
which additionally contains uncommitted normal-page wiring. Aggregate logs are
not isolated exact-tree/public acceptance. No shared/Host/candidate build or
deployment occurred. A exact combined independent review remains required.

Normal-page wiring is deliberately excluded: its discovered comment adapter
passes txn instead of transactionId and is awaiting the reported correction
decision. It currently fails before dispatch and retains the protected intent.
This read slice must not be called a working mounted comment flow. Production
reader key/HS/RP/existing-MXID provenance, actual Matrix readback, unknown
unindexed event settlement and complete Social v2 remain unverified.
