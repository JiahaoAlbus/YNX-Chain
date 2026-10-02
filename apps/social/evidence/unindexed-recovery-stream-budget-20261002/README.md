# Original unknown-delivery recovery and bounded media checks

Parent: 17395e3b57607cc9df077740fc9b26c2dfa32183.
Status: owned source and isolated QA only; no public/installed acceptance.

## Original failures retained

original-root17395-stream-budget-fail.json is the byte-preserved Root report: a valid 512 KiB attachment in 512 normal 1 KiB chunks caused authorization/identity calls proportional to chunk count and failed a controlled existing 300/min authority budget. This is a source usability failure, not an observed public HTTP 429.

original-root17395-authority-deadline-fail.json also preserves Root's actual unchanged-timer failure: after the original 30 seconds, an aborted fetch signal did not settle a permanently pending authority callback or clean the tracked operation. It is not an observed public outage.

The first execution of the new recovery probe also failed four positive cases with `Original encrypted event ownership is not confirmed` (cold text, cold prepared file, unindexed comment, warm receipt); its eleven negative cases passed. That observation is retained here from the original tool transcript, not presented as a raw saved stdout artifact. The new code had incorrectly queried a nonexistent MatrixEvent.getStatus method. It now uses the locked SDK's real status property. Tests exercise the SDK's default remote status, not a manufactured substitute method.

## Media successor

Every stream await still checks local original operation/view/abort state. Remote identity/audience checks run before and after fetch, before and after SDK decrypt, at final indexed read/return, and periodically after five seconds during long streams. Network signing/REST traffic is no longer driven by HTTP chunk boundaries. No rate budget is raised, no grant is extended or cached, and no final authority check is removed.

A local bounded-operation helper now races awaited callbacks, fetch, stream reads, codec results, and final consumer/recovery checks against cancellation/deadline. The original 30-second ceiling remains. Stop cancels even a callback that ignores AbortSignal; late results are discarded, and late byte buffers are wiped. Final protected clear receives the same original-view/deadline guard. This is finite UI waiting, not a replacement proof/SDK, grant timeout, or automatic retry mechanism.

current-stream-budget.json records 512 real 1 KiB chunks decrypted with 11 authority and 7 identity calls against the unchanged controlled 300/min budget. Local stale-view interruption and a real delayed stream revocation are covered. Existing endpoint/credential, redirect, cap, hash, lock, and Blob protections are rerun.

## Non-resending recovery

The normal composer exposes an explicit Verify original publication without resending button. It loads the original account/device protected record, checks current identity/audience, observes authenticated SDK remote events, and uniquely matches the original transaction or original warm send receipt. It compares exact sender, text, semantic fields, original file/info, and parent relation before using the existing action=index authority. No Matrix sendMessage or uploadContent is called by recovery.

Pending local echoes cannot settle delivery. Other senders' transaction metadata is not exposed as an own remote receipt. Ambiguous/missing receipts, changed original content, index failures, and final revocation retain the original protected intent. Only successful current authorization and original confirmation permit the existing guarded clearConfirmed operation.

The comment recovery path first uses existing indexes; if the original index is missing, it can verify the actual original remote echo and commit only its original index. This is Matrix readback plus metadata recovery, not a claim that all recovery is backend-write-free.

## Fresh isolated evidence

- unindexed-original-recovery.json: 15 actual owned transport/consumer and locked SDK MatrixEvent cases, including original text/file/comment and warm lost-index outcomes. Matrix decrypt/trust and server authority are controlled fixtures.
- cold-vault-composer-recovery.json: actual browser composer button, real IndexedDB/WebCrypto, original wrapping record/key and closed/reopened vault. Original text and prepared file clear only on success; missing receipt and late revocation retain byte-equivalent original payload. All cases send/upload zero times.
- current-stream-budget.json: 3 real codec/multichunk and bounded-check cases.
- current-bounded-deadline.json: actual unchanged 30-second callback deadline plus stop/parent-abort cancellation of nonsettling identity, reader, and recovery callbacks; isolated short-deadline primitive codec/late-buffer cleanup case.
- media-security.json and mounted-feed-media.json: previous media security and actual browser saved-download regressions.
- original-read-probe.json, original-protected-feed-dom.json, original-independent-feed.json, original-comment-recovery.json, original-independent-recovery.json: inherited exact probe assertions rerun, not replaced with receipt-only tests.
- typecheck.txt, consumers-test.txt, normal-entry-bundle.txt: normal current frontend checks. The normal build is not a deployment artifact.
- approved-formal-overlay-race.txt: fresh uncached race tests for internal/social and cmd/ynx-sociald with Root's formal shared-288 Go-only overlay. root-formal-overlay-binding.json preserves Root's exact 23-file binding check. These remain isolated combined-source regressions, not a production/shared Host activation claim.

SHA256SUMS and SOURCE_BLOBS.txt bind the evidence/source bytes inside the enclosing immutable commit.

## Remaining scope

Only available authenticated remote echoes or the original known warm receipt can settle. Absent transaction metadata or history outside the current synchronized SDK timeline remains unknown, not proof of nondelivery. An unknown upload lacking its original prepared descriptor cannot be recovered by guessing an MXC, generating a new transaction, or uploading again. Those broader durable settlement gates remain incomplete.

No live HS/RP/existing-MXID, full normal login, Native/cross-node, public/installed, or Wallet lifecycle acceptance is claimed. No production identity/key, new shared SDK/vendor, Host configuration, wallet account/sign/transaction, or deployment is created. Full Social v2 remains active; Root is 接续测试网生态审计工作 and A remains the sole deployment/shared/Host writer.
