# Actual isolated follow-up

Parent 7a5c7552a0a36eb8c79b7526bf5b06b429d7ad73. First-request Map-key QA defect fixed by selecting exact current transaction ID; original failed receipt retained in matrix-followup-20261001.

## Federation and restart

Eight checks passed: two private homeservers, unverified send rejection, fresh explicit rejection, SAS confirmation, bidirectional text, both-server ciphertext readbacks, encrypted attachment, original-device cold offline history.

Repeat verification after restart FAILED. New transaction was present in receiver requests, already Cancelled (5) with m.user, and initiator also reached Cancelled. Receiver replayed the previous completed transaction as Requested before it became Cancelled. This disproves missing-request speculation for this run. Exact cancellation trigger is not yet proved; no relaxation to treat automatic cancellation as explicit user rejection. Protocol receipt includes transaction-linked states. Does not prove public or normal product acceptance.

## Real added device

Four checks passed with separate disposable accounts/profiles on the same isolated two-server runtime: initial trusted encrypted send; second actual peer device discovered without resetting original cross-signing identity or store; changed-device send rejected followed by unverified-device send rejection; device removal refuses absent confirmation.

Actual confirmed DELETE device returned HTTP401 through standard SDK. Removal, token invalidation, post-revocation resumption, revoked-device new-key exclusion remain NOT_VERIFIED. Full response/UIA flows were not captured, so 401 is not presented as a conclusively identified authentication challenge. Production delegated issuer/reauth callback contract remains A-owned; do not solve via AS/admin credentials in product or reset keys.

Own QA containers/network stopped; local durable profiles retained. No user accounts, deployment, sign or chain transaction. New-device verification/history/backup, production bridge, Native and public user flow remain NOT_VERIFIED.
