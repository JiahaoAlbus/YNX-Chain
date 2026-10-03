# Current-view moment report boundary

Parent: 4110559bb05409db03d2f0a62c054ca832fa8ad9.

The original native Moments report confirmation remains unchanged. The owned
submission path now captures the original authorization guard and mount state,
checks before fingerprinting and again before sending the report, and publishes
the response only while that original view remains current. Error presentation
is also limited to the original current view. A stale response is not rollback
or permission to resend a possibly committed effect.

The helper is only a UI-current guard, not an authorization grant, signature,
server receipt or permission substitute. The original backend API and report
payload remain unchanged. This change does not implement a durable report
outbox; unknown report outcomes and installed recovery still need their full
product acceptance, rather than borrowing the existing follow/reaction/delete
ledger as a generic report authority.

Project typecheck and 20 tests passed: six new report boundary cases plus the
existing native action and durable action tests. These cover pre-stale input,
authority change during fingerprint, stale late response, valid fingerprint,
invalid fingerprint and unknown effect without automatic retry. Actual native
Android/iOS bundle result is recorded in status.txt/native-build.txt.

No real report was submitted, no device window was used, no account/signing or
transaction occurred, and no deployment was performed. Source/bundle checks do
not prove an installed/private/public ordinary-user workflow or MONSTER
acceptance. The known public provider source mismatch remains independently
open and is not changed by this native UI repair.
