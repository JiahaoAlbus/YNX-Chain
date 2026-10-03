# Exact inactive provider to Social native composition requirements

Social consumer source: d4f6cde5035d70c480ce3471c9b052a776f9e1b7.
Durable route binding source: 57d55f2c0a3e734a406036dc09a8e478581da9ef.
No shared producer was modified, imported, activated, or registered here.

Read-only candidate inputs:

- source/provider.go SHA256 f61abd5a9a6fce98a9a8bb5bc17d6443aac9f9443efba67bc3362cf8111a0abc
- CONSUMER_CONTRACT.md SHA256 ede7849e212f0065c51b9704951360775c05f33902562c1cfbcd72a88fb7f9d1
- Candidate directory: recovery-20261004/social-independent-provider-candidate-20261004

## Exact field mapping, only after actual producer admission

The protected accepted Route.StableRoute maps to the authenticated application
route. Local/Peer Name, Number, Identity and Generation map without aliases,
normalization, identity regeneration or account-derived keys to the two Signal
addresses, original 33-byte public identity pins and unsigned generations.
Route.Epoch maps to the authenticated application epoch, not a process epoch.
Suite must remain signal-session-0.104.0. Owner and provenance fields remain
protected producer admission inputs; legacy Chat or Matrix identity is not
their proof. Identity arrays must be copied before encoding or asynchronous use.

The candidate's public Grant.Context() returns Route. The observed Route fields
are Handle, StableRoute, Local, Peer, Epoch, Suite and AcceptanceDigest. They do
not by themselves carry the admitted native Matrix homeserver/self/peer/room
binding needed by VeilMatrixPipeline.NativeRoutes. A separate actual protected
Matrix routing producer must bind these to the same accepted route and original
Client/Room; caller strings, session success and MXID equality are insufficient.

## Durable generation and lifetime are different

Candidate Snapshot.DirectoryGeneration is distinct from Snapshot.Revision and
Checkpoint.Revision. Candidate Grant.Recheck compares its original directory
generation with the current snapshot. The Social VMX3 record needs the exact
durable admitted routing generation whose observer invalidates the original
route. The bridge must explicitly establish whether DirectoryGeneration is
that value, and expose the original authenticated grant-bound value through a
controlled native handle. Do not reread an unrelated latest snapshot or use
directory/checkpoint writes, a grant expiry, process restart, JS number, or a
locally generated counter as that generation.

Go uint64 values must retain all 64 bits in Java long/Kotlin Long. Zero is
invalid; a negative signed representation is not automatically invalid. Do not
round through a JS number. Fresh grants may renew a runtime lease without
changing durable route identity; their runtime expiry is not the persisted
generation. Same admitted generation/context/route cold reopen is legitimate;
changed admitted generation with identical public context/route must HOLD.

## Concrete producer work routed to the sole controller

Implement the actual original-policy/review/directory/current-observer and
Native bridge composition under the existing shared owner. Supply an opaque
grant-bound accessor for the admitted durable routing identity/generation and
the actual authenticated Matrix route binding. Compose native final commit
guards with Grant.Recheck after record handles finish. Bind the original Native
key alias and checkpoint namespace independently before anchor advancement.
Ensure effect exclusion/current observers cover the actual platform and process
scope; the candidate explicitly only guarantees local-process exclusion.

Do not add a consumer flag or serialize a Context as trust evidence. Missing
real producers stay typed unavailable. Unknown anchor/record publication must
enter protected recovery, never auto-enroll or reset. The original provider
review and real native-platform validation must remain separate gates.

## Evidence limits

This artifact is an exact source-contract integration finding, not a tested
bridge or provider admission. No real enrollment, policy, review emitter,
monotonic anchor, protected OS bridge, Matrix effect, raw pre-FFI UTF-8 check,
bounded SDK stream, platform install, public lifecycle or MONSTER acceptance
has been demonstrated by this mapping. Existing dormant source tests do not
close any of those gates. No account/signing/transaction/deployment occurred.
