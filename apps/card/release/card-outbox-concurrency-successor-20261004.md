# Card durable outbox concurrency successor

Source e3cb3ceb81b94f4ae90de2983d33c88f22bb0250/tree d70cf21c135e65b91d951a537191042497c95657. Existing original CardService, encrypted owner storage, ledger and captured-current fences retained.

Actual gap: two same-owner flushEvents calls could publish the same pending batch simultaneously; transport received a mutable event object whose identity could be changed before acknowledgement. The successor establishes a same-service, per-owner single-flight lock before invoking transport, publishes a recursively frozen structured clone, and releases the lock on completion or refusal. Different owners do not block each other. Failed sends preserve original event IDs and increment durable attempts; cold retries retain the same event. No event schema, funding policy, Card balance or Wallet authority changed.

Delivery remains at-least-once. This is not a distributed lease: separate processes may retry the same stable event ID, and the accepted receiving transport must deduplicate. A network acceptance followed by acknowledgement loss may also retry. A resolved transport callback is only internal outbox delivery state, not independent proof of Data Fabric/Billing acceptance. No external endpoint, secret, global contract, account permission or receiver was invented.

New actual SQLite-backed tests3/3: overlapping same-owner flush with independent second owner; immutable event/details and original acknowledgement identity; worker outage releases lock and stable retry survives reopen. Uses explicit software draft-only subjects, unavailableWallet/unavailableCore, zero real accounts/cards/funding. Dedicated test SQLite retained; no existing user data removed.

Whole backend138/138 passed (0 fail/skip), server compiler-only typecheck passed. Prior frontend403/additional8 and Web/native builds are separate source0fd evidence, not relabeled. New backend esbuild283207B is source-bound in outbox-e3cb3ceb8-backend-build-20261004.json; protected backend not executed.

Actual e3 source local subprocess verifier also passed: public version200/325B, private state503/165B; missing private original current refused before database with exit1. Retained runtime-e3cb3ceb8-20261004 contains response hashes and process logs. No formal Host/alias mutation, real Wallet account request/sign/send, external Data Fabric delivery or protected actor admission.

Full public TEST registration, approved account/signature, real YNXT receipt plus Card credit, lifecycle ledger readback, receiver delivery and revoke/degradation E2E remain incomplete. originalCardRuntimeInputs.current remains genuine-producer-only, not populated from fixtures or ENV. Public product readiness/PSv2/migratedV2/real issuance/PAN/CVV/fiat/real merchant/productionRealPayments remain false.
