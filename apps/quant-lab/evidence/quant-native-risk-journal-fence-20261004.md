# Native risk journal / readiness fence successor

Predecessor source e38ad379bf0721d9dca1bdf64cc55b23d3f076f8; evidence d4dc4b7b826d5b6e7c165665b8935db0253fbc77 preserved.

The original risk controller previously skipped journal removal on changed/missing storage but still returned the old receipt as resolved. It now requires exact original submitted journal bytes before retirement and success. Replaced, corrupt or missing journal returns PAPER_PENDING_MISMATCH, without overwriting a different journal or silently regenerating a key. Loss of same-owner readiness rejects old completion and preserves original UNKNOWN. Explicit confirmation/retry, server idempotency, original risk engine and scope remain unchanged.

The action-view operation fence now also requires connected/ready. Identity/readiness retirement clears stale previous receipt feedback while retiring the old local operation. Old callbacks cannot write back over the current unavailable/B feedback or re-enable controls. Normal native workspace sign-in, refresh, unknown-signal reload/retry, halt/reconcile, read-only receipt recovery and revoke remain tested.

Affected tests: 7 risk controller + 2 actual original button/controller Chrome + 1 original native-session controlled browser journey = 10 PASS (4058.469333 ms). Order/backtest/reader tests 27 PASS (78.8765 ms). Syntax/diff and six asset pins verified. No Go/backend changes; prior e38 full Go/Node results remain historical exact results, not a new full-suite claim for this successor.

Initial affected run preserved: 9 PASS / 1 native-session browser timeout (45576.300833 ms), waiting for obsolete late error feedback after workspace had retired. Fixture now observes genuine private ready=false, exact retained UNKNOWN bytes and disabled review instead of requiring a retired catch to overwrite current feedback. New unit and actual-button regressions prove replacement preservation and readiness retirement directly. It does not weaken server/action success checks or authorize new behavior.

All browser transport/native identities are controlled local fixtures, not real Wallet approval. No SSH, upload, Host/public change, account request, signature, transaction, shared SDK or protocol edit occurred. Formal public/installed/real-wallet/ComputerControl gates remain false. Formal publisher remains the existing A/wallet_release_owner.
