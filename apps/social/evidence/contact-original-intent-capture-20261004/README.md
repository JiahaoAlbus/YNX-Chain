# Original contact recovery intent capture

Original counterexample source was inspected at 2114b79a846ba322082148667fa00f0ac1bdf762.
Product nativeContactIntent.ts remained unchanged through the higher-priority
parent-cleanup repair. This continuation bases its change on
0f04e2f01d41114af348f06ce41f61b95ccfc80c,
tree dff442511476b474911a5cfca3595da8b1ab47b9.
Controller: 01a094cc-0ba3-7901-bcd5-56fce8330c0d.

## Original failures retained

The original three controlled tests all failed (0 PASS, 3 FAIL), preserved in
original-red.txt before any product contact source edit:

- returned() awaited the original storage read while still referencing the caller
  intent. Changing caller message/target/key during that await incorrectly rejected
  the original returned operation rather than marking its exact retained intent.
- The validated detached intent was not frozen.
- Prepared and loaded recovery records were not immutable snapshots.

This reproduction used synthetic account/profile/intent data and controlled
storage. No actual contact request, Product Session or original SecureStore was
invoked. During the independent parent P2 fix these original failures were parked,
not discarded or mislabeled; the product contact file was not partially changed.

## Owned repair

NativeContactIntent is readonly. checkedNativeContactIntent preserves the existing
strict field/value/account checks and now returns a detached frozen record. The
caller input is not frozen or changed. All fields in the accepted record are
primitive; no mutable nested payload is admitted by its existing exact shape.

returned() preserves its initial current-authorization check, then validates and
captures the original intent BEFORE entering the original account lane and awaiting
storage. The storage comparison and operationReturned marker use that captured
original, not a later caller edit. Existing account locks, original pending intent
checks, current guards before/after awaits, corrupted-carrier preservation and
same-key/different-request rejection remain unchanged.

operationReturned means only an API operation returned, NOT delivered, accepted,
friend relationship or a private-service authorization. Unknown requests are not
deleted or replaced. No new producer/grant, identity, key or storage format exists.

## Checks and outstanding acceptance

Related nativeContactIntent/contact cancellation/proof/retry/review tests:
56 PASS, 0 FAIL. Full owner tsc --noEmit: exit 0. Isolated current-source web build:
exit 0. The original three tests are now permanent product-source regressions.

These are controlled mechanism and compatibility checks, NOT actual SecureStore
durability, private session/permission, source-matching installed contact UI,
cross-node friendship or MONSTER ordinary-user acceptance. No real contact/account
request, signing, transaction, deployment, installation or new crypto activation
was performed. Actual UI/private-service readback needs the existing original
admitted producer, matching installed source and authorized device through Root
and the native owners; synthetic intent fixtures are not a substitute.

The predecessor whole-parent cleanup candidate and original independent HOLD/FAIL
records remain intact. This later commit does not rewrite an earlier frozen web
deployment artifact or imply whole-source independent approval. All other owner
changes, inherited accounts/keys/queues/cache/APKs are preserved.
Full Social/crypto649 remains NOT_COMPLETE.
