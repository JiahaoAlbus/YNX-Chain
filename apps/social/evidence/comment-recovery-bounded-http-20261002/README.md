# Normal comment recovery cancellation successor

Parent source: c53cd9d6762ee5f86317861d8e9fc77c107d2dd8.
Status: owned source and isolated QA only, pending independent Root review.

## Exact original observation

original-root-c53-comment-deadline-fail.txt preserves the original B/Root report. The normal Verify original pending comment button, actual HTTP indexes client, actual SDK parent consumer, and original protected vault remained busy after the original 30-second deadline when indexes fetch never returned. Intent/clear/send/upload preservation alone did not prove bounded waiting.

The original independent probe is copied without changes into scripts/independent-comment-recovery-deadline-check.mjs and rerun here. same-root-probe-current.json deliberately retains its old c53 source label and UNEXPECTED output label. Actual observations establish the repair: after its unchanged 30-second wait the recovery button is no longer disabled, original intent JSON is identical, and clear/send/upload remain zero before and after Stop plus late fetch release. The execution command also asserts those observations; raw output labels are not rewritten as PASS.

## Runtime changes

- Entire normal comment recovery, including original commentSender, index lookup, existing indexed consumer.read, fallback recovery, and final clear, shares finite local cancellation/deadline guards.
- Normal feed Stop/destroy cancels its active recovery. The scope is registered with the actual transport so transport Stop also actively rejects a nonreturning callback rather than waiting for its eventual return.
- The owned HTTP indexes/authorize/resolve client forwards AbortSignal to fetch and bounds restore, proof, CSRF, REST, and response JSON waits. Late proof completion cannot dispatch a fresh REST request after cancellation.
- Signal and original current-view guard pass through normal session wiring and authority checks. Existing signed DTO bytes, scopes, routes, identity checks, and final current permissions are preserved.
- Original protected clearConfirmed receives the current-view/deadline guard inside the existing vault transaction. Late clear cannot remove the original record after lock/cancel.

No SDK/verifier, crypto algorithm, grant TTL, permission standard, nonce policy, or rate budget is changed. No automatic send/reupload or fallback identity is introduced.

## Fresh evidence

- http-helper-cancel.json: five actual HTTP client/recovery helper cases covering nonsettling fetch/read/response JSON, late signing result, and positive indexed original confirmation.
- normal-feed-vault-cancel.json: six actual browser feed-button/vault/HTTP/SDK consumer cases. Sender, REST fetch, decrypt/read, and final-clear interruption retain the original protected record; positive current confirmation clears once; console/page errors are zero.
- Original feed/vault, independent feed, comment/helper recovery, and read probes are rerun. The two older route-based browser fixtures initially failed dynamic module loading because their explicit route maps did not serve bounded-operation.mjs. Those original failures remain in the tool transcript; only dependency serving was added, with assertions unchanged.
- Cold publication composer, unindexed original recovery, 512-chunk budget, media security, and actual mounted browser-download regressions are rerun.
- consumers-test.txt, typecheck.txt, normal-entry-bundle.txt: 111 normal consumer tests, current typecheck, ordinary session UI bundle. Not release builds or deployed runtime evidence.

SOURCE_BLOBS.txt and SHA256SUMS bind changed source/evidence bytes in the enclosing immutable commit.

## Remaining full goal

Fixtures use controlled SSO/proof/Matrix trust and synthetic original records, not live HS/RP/existing MXID, public source-bound normal login, installed Native/cross-node, or Wallet/Relay acceptance. Missing remote transaction metadata/history and unknown uploads without original prepared descriptors remain unknown and are not resent. Full Social v2 stays active.

No deployment, sensitive Wallet account/sign/transaction, new real identity/key, shared/vendor generation, writer2 vercel.json, or Host changes occur. Root is 接续测试网生态审计工作; A remains the sole shared/Host/deployment writer.
