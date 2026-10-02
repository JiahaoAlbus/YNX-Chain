# Normal source wiring and immutable await guards

Normal session entry now mounts the actual feed consumer after the original
Matrix connection. It reuses original identity, transport, captured view,
publishing HTTP authority, guarded protected vault and serialized work. Lock
clears/destroys the view without deleting keys/history/drafts. Existing explicit
publishing permission is required; no silent approval or identity replacement.

The normal comment adapter now supplies the actual transactionId parameter.
Swallowed work errors/busy return cannot become confirmation or clear an intent.
Consumer read clones its index before any await. Feed view clones/freezes the
original index, decoded event, parent and protected intent before storage waits;
publication uses those original snapshots rather than mutable callback objects.
Recovery clones the matched index before consumer.read and never builds a
receipt from an externally mutable reference after awaiting.

Canonical checks use the original ynx-social-matrix-moment/v1 contract: audience
kind/revision/owner/membership, indexed event ID, original parent protocol and
identity, bounded nonblank text, and the actual consumer's decrypted return
shape. Explicit extra protocol/kind fields cannot contradict the canonical
event. Prior incomplete controlled fixtures now use the actual canonical
protocol and eventId. The actual class remains responsible for authenticating
the encrypted SDK event, sender, semantic payload and comment relation.

An uncertain in-memory storage reservation is retained when refresh returns
null; different stored intent does not overwrite it. No new transaction/save
or send is allowed until original recovery. This warm-view fence is not proof
of durable storage completion or remote unknown settlement.

Original 525 review and its nine failures are preserved in feed-guards/20261002.
Both independent probe files are included unchanged. The same helper probe now
passes 10/10, same real DOM/WebCrypto/IndexedDB probe 4/4, zero skips. Original
controlled 20 checks pass with canonical fixtures. Actual service metadata ->
HTTP parser -> actual class read/publish/read 6/6, npm111, typecheck and normal
entry browser bundle pass. Matrix SDK/authority/publication are controlled;
the bundle is not a runtime login, actual homeserver or public acceptance.

Central independently reviews the exact source successor before integration.
Reader injection still requires the separately approved shared loader and
protected configuration, with A retaining shared/build/Host/key/registry scope.
Actual public/installed flows, HS/RP/existing MXID provenance, unindexed event
and unknown attachment settlement and full Social v2 remain incomplete.
No deployment, Wallet account approval/sign/transaction, producer key, shared,
Host, vendor or A-owned vercel changes were made in this successor.
